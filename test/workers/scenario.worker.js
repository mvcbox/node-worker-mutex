'use strict';

const { parentPort, workerData } = require('worker_threads');

let activeMutexBuffer = null;
let wakeCalls = 0;

if (workerData.installWakeOnly) {
  const nativeNotify = Atomics.notify;
  Atomics.wake = function wake(array, index, count) {
    if (array.buffer === activeMutexBuffer) {
      wakeCalls += 1;
    }

    return nativeNotify.call(Atomics, array, index, count);
  };
  Atomics.notify = undefined;
}

if (workerData.dropWake) {
  const nativeNotify = Atomics.notify;
  const nativeWake = Atomics.wake;
  Atomics.notify = function notify() {
    const array = arguments[0];

    if (array.buffer === activeMutexBuffer) {
      wakeCalls += 1;
      return 0;
    }

    if (typeof nativeNotify === 'function') {
      return nativeNotify.apply(Atomics, arguments);
    }

    return nativeWake.apply(Atomics, arguments);
  };
  Atomics.wake = function wake() {
    const array = arguments[0];

    if (array.buffer === activeMutexBuffer) {
      wakeCalls += 1;
      return 0;
    }

    if (typeof nativeWake === 'function') {
      return nativeWake.apply(Atomics, arguments);
    }

    return nativeNotify.apply(Atomics, arguments);
  };
}

if (workerData.failRecursionStoreAfterAcquire) {
  const nativeStore = Atomics.store;
  let failed = false;
  Atomics.store = function store(array, index, value) {
    if (
      !failed &&
      array.buffer === activeMutexBuffer &&
      index === 8 &&
      value === 1
    ) {
      failed = true;
      throw new Error('INJECTED_RECURSION_STORE_FAILURE');
    }

    return nativeStore.call(Atomics, array, index, value);
  };
}

if ((workerData.observeWaitAsync || workerData.pauseBeforeWaitAsync) && typeof Atomics.waitAsync === 'function') {
  const nativeWaitAsync = Atomics.waitAsync;
  const control = workerData.controlBuffer
    ? new Int32Array(workerData.controlBuffer)
    : null;
  let paused = false;
  Atomics.waitAsync = function waitAsync(array, index, value, timeout) {
    const isMutexWait = array.buffer === activeMutexBuffer;

    if (
      workerData.pauseBeforeWaitAsync
      && !paused
      && control
      && isMutexWait
    ) {
      paused = true;
      parentPort.postMessage({ type: 'before-wait-async' });

      while (Atomics.load(control, 0) === 0) {
        Atomics.wait(control, 0, 0);
      }
    }

    const result = nativeWaitAsync.call(Atomics, array, index, value, timeout);

    if (isMutexWait) {
      parentPort.postMessage({
        type: 'wait-registered',
        async: !!(result && result.async),
        timeout,
      });
    }

    return result;
  };
}

if (workerData.observeWait || workerData.pauseBeforeWait) {
  const nativeWait = Atomics.wait;
  const control = workerData.controlBuffer
    ? new Int32Array(workerData.controlBuffer)
    : null;
  let paused = false;
  Atomics.wait = function wait(array, index, value, timeout) {
    const isMutexWait = array.buffer === activeMutexBuffer;

    if (isMutexWait) {
      parentPort.postMessage({ type: 'wait-called', timeout });
    }

    if (
      workerData.pauseBeforeWait
      && !paused
      && control
      && isMutexWait
    ) {
      paused = true;
      parentPort.postMessage({ type: 'before-wait' });

      while (Atomics.load(control, 0) === 0) {
        nativeWait.call(Atomics, control, 0, 0);
      }
    }

    return nativeWait.call(Atomics, array, index, value, timeout);
  };
}

if (
  workerData.pauseAfterAcquireCas ||
  workerData.pauseAfterRollbackCas
) {
  const nativeCompareExchange = Atomics.compareExchange;
  const control = new Int32Array(workerData.controlBuffer);
  let paused = false;
  Atomics.compareExchange = function compareExchange(array, index, expected, replacement) {
    const result = nativeCompareExchange.call(Atomics, array, index, expected, replacement);

    if (
      workerData.pauseAfterAcquireCas
      && !paused
      && array.buffer === activeMutexBuffer
      && expected === 0
      && replacement > 0
      && result === 0
    ) {
      paused = true;
      parentPort.postMessage({ type: 'after-acquire-cas' });

      while (Atomics.load(control, 0) === 0) {
        Atomics.wait(control, 0, 0);
      }
    }

    if (
      workerData.pauseAfterRollbackCas
      && !paused
      && array.buffer === activeMutexBuffer
      && expected > 0
      && replacement <= 0
      && result === expected
    ) {
      paused = true;
      parentPort.postMessage({ type: 'after-rollback-cas', replacement });

      while (Atomics.load(control, 0) === 0) {
        Atomics.wait(control, 0, 0);
      }
    }

    return result;
  };
}

const { WorkerMutex } = require(workerData.libPath);

function waitForMessage() {
  return new Promise((resolve) => {
    parentPort.once('message', resolve);
  });
}

async function waitForStart() {
  parentPort.postMessage({ type: 'ready' });
  const start = await waitForMessage();

  if (!start || start.type !== 'start') {
    throw new Error('START_MESSAGE_REQUIRED');
  }

  return start;
}

async function acquire(mutex, mode, recursionDepth) {
  if (mode === 'BLOCKING') {
    for (let depth = 0; depth < recursionDepth; depth += 1) {
      mutex.lock();
    }

    return null;
  }

  return mutex.acquireAsync();
}

function release(mutex, mode, lease, recursionDepth) {
  if (mode === 'BLOCKING') {
    for (let depth = 0; depth < recursionDepth; depth += 1) {
      mutex.unlock();
    }
  } else {
    lease.release();
  }
}

async function holdMutex(mutex, mode, recursionDepth) {
  const lease = await acquire(mutex, mode, recursionDepth);
  parentPort.postMessage({ type: 'owned', recursionDepth });

  while (true) {
    const command = await waitForMessage();

    if (command.type === 'exit') {
      process.exit(command.code === undefined ? 17 : command.code);
    }

    if (command.type === 'release') {
      release(mutex, mode, lease, recursionDepth);
      parentPort.postMessage({ type: 'released', wakeCalls });
      return;
    }
  }
}

async function run() {
  const start = await waitForStart();
  const mutexBuffer = start.mutexBuffer;
  activeMutexBuffer = mutexBuffer;

  if (workerData.markerBuffer) {
    Atomics.store(new Int32Array(workerData.markerBuffer), 0, 1);
  }

  if (workerData.scenario === 'hold') {
    const mutex = new WorkerMutex(mutexBuffer);
    await holdMutex(mutex, workerData.mode, workerData.recursionDepth || 1);
    return;
  }

  if (workerData.scenario === 'wait-once') {
    const mutex = new WorkerMutex(mutexBuffer);
    let lease;

    if (workerData.mode === 'ASYNC') {
      const pending = mutex.acquireAsync();
      await Promise.resolve();
      parentPort.postMessage({ type: 'async-pending' });
      lease = await pending;
    } else {
      lease = await acquire(mutex, workerData.mode, 1);
    }

    parentPort.postMessage({ type: 'acquired' });
    release(mutex, workerData.mode, lease, 1);
    parentPort.postMessage({ type: 'released', wakeCalls });
    return;
  }

  if (workerData.scenario === 'release-and-wait') {
    const mutex = new WorkerMutex(mutexBuffer);
    const lease = await acquire(mutex, workerData.mode, workerData.recursionDepth || 1);
    parentPort.postMessage({ type: 'owned' });
    const releaseCommand = await waitForMessage();

    if (releaseCommand.type !== 'release') {
      throw new Error('RELEASE_COMMAND_REQUIRED');
    }

    release(mutex, workerData.mode, lease, workerData.recursionDepth || 1);
    parentPort.postMessage({ type: 'released', wakeCalls });
    const command = await waitForMessage();

    if (command.type !== 'exit') {
      throw new Error('EXIT_COMMAND_REQUIRED');
    }

    process.exit(command.code === undefined ? 0 : command.code);
  }

  if (workerData.scenario === 'blocking-errors') {
    const mutex = new WorkerMutex(mutexBuffer);
    let nonownerCode = null;

    try {
      mutex.unlock();
    } catch (error) {
      nonownerCode = error && error.code;
    }

    mutex.lock();
    mutex.lock();
    mutex.unlock();
    parentPort.postMessage({ type: 'blocking-errors', nonownerCode, partial: true });
    const command = await waitForMessage();

    if (command.type === 'release') {
      mutex.unlock();
      parentPort.postMessage({ type: 'released' });
      return;
    }

    throw new Error('RELEASE_COMMAND_REQUIRED');
  }

  if (workerData.scenario === 'unlock-only') {
    const mutex = new WorkerMutex(mutexBuffer);
    let code = null;

    try {
      mutex.unlock();
    } catch (error) {
      code = error && error.code;
    }

    parentPort.postMessage({ type: 'unlock-only', code });
    return;
  }

  if (workerData.scenario === 'recursion-errors') {
    const mutex = new WorkerMutex(mutexBuffer);
    const cells = new Int32Array(mutexBuffer);
    mutex.lock();
    cells[8] = 0;
    let underflowCode = null;

    try {
      mutex.lock();
    } catch (error) {
      underflowCode = error && error.code;
    }

    cells[8] = 2147483647;
    let overflowCode = null;

    try {
      mutex.lock();
    } catch (error) {
      overflowCode = error && error.code;
    }

    cells[8] = 1;
    mutex.unlock();
    parentPort.postMessage({ type: 'recursion-errors', underflowCode, overflowCode });
    return;
  }

  if (workerData.scenario === 'nested-bind') {
    let code = null;

    try {
      WorkerMutex.bindWorkerExit({
        get worker() {
          throw new Error('WORKER_INPUT_MUST_NOT_BE_READ');
        },
        get sharedBuffer() {
          throw new Error('BUFFER_INPUT_MUST_NOT_BE_READ');
        }
      });
    } catch (error) {
      code = error && error.code;
    }

    parentPort.postMessage({ type: 'nested-bind', code });
    return;
  }

  throw new Error(`UNKNOWN_SCENARIO_${workerData.scenario}`);
}

run().catch((error) => {
  parentPort.postMessage({
    type: 'error',
    code: error && error.code,
    error: error && error.stack ? error.stack : String(error),
  });
  process.exitCode = 1;
});
