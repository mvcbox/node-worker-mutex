'use strict';

const assert = require('assert');
const path = require('path');
const workerThreads = require('worker_threads');
const Worker = workerThreads.Worker;
const isMainThread = workerThreads.isMainThread;
const parentPort = workerThreads.parentPort;
const workerData = workerThreads.workerData;
let activeMutexBuffer = null;
const symbolDisposeBeforeRequire = typeof Symbol.dispose;
const symbolAsyncDisposeBeforeRequire = typeof Symbol.asyncDispose;
const disposableStackBeforeRequire = typeof global.DisposableStack;
const asyncDisposableStackBeforeRequire = typeof global.AsyncDisposableStack;
const suppressedErrorBeforeRequire = typeof global.SuppressedError;

if (!isMainThread && workerData.observeWait) {
  const nativeWait = Atomics.wait;
  Atomics.wait = function wait(array, index, value, timeout) {
    if (array.buffer === activeMutexBuffer) {
      parentPort.postMessage({ type: 'wait-called', timeout: timeout });
    }

    return nativeWait.call(Atomics, array, index, value, timeout);
  };
}

const packageDirectory = isMainThread ? process.argv[2] : workerData.packageDirectory;

if (!packageDirectory) {
  throw new Error('USAGE: node-10.5.smoke.js <package-directory>');
}

const workerMutexPackage = require(path.resolve(packageDirectory));
const WorkerMutex = workerMutexPackage.WorkerMutex;
const WorkerMutexError = workerMutexPackage.WorkerMutexError;
const WorkerMutexErrorCodeEnum = workerMutexPackage.WorkerMutexErrorCodeEnum;
const WorkerMutexLease = workerMutexPackage.WorkerMutexLease;
const WorkerMutexModeEnum = workerMutexPackage.WorkerMutexModeEnum;
const ERROR_CODES = [
  'HANDLE_MUST_BE_A_SHARED_ARRAY_BUFFER',
  'MUTEX_BUFFER_SIZE_MUST_MATCH_SINGLE_MUTEX',
  'MUTEX_IS_NOT_OWNED_BY_CURRENT_THREAD',
  'MUTEX_RECURSION_COUNT_UNDERFLOW',
  'MUTEX_RECURSION_COUNT_OVERFLOW',
  'WORKER_INSTANCE_MUST_SUPPORT_EXIT_EVENT',
  'WORKER_THREAD_ID_MUST_BE_A_POSITIVE_INTEGER',
  'WORKER_IS_ALREADY_EXITED',
  'WORKER_EXIT_BINDING_REQUIRES_MAIN_THREAD',
  'WORKER_THREADS_ARE_NOT_AVAILABLE',
  'SHARED_ARRAY_BUFFER_IS_NOT_AVAILABLE',
  'REQUIRED_ATOMICS_OPERATIONS_ARE_NOT_AVAILABLE',
  'REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE',
  'CRYPTO_RANDOM_IS_NOT_AVAILABLE',
  'WORKER_MUTEX_REGISTRY_IS_INCOMPATIBLE',
  'MUTEX_MODE_MUST_BE_BLOCKING_OR_ASYNC',
  'MUTEX_BUFFER_LAYOUT_IS_NOT_SUPPORTED',
  'MUTEX_BUFFER_MUST_NOT_BE_GROWABLE',
  'MUTEX_BUFFER_ID_IS_INVALID',
  'MUTEX_MODE_DOES_NOT_SUPPORT_BLOCKING',
  'MUTEX_MODE_DOES_NOT_SUPPORT_ASYNC',
  'MUTEX_BLOCKING_LOCK_NOT_ALLOWED',
  'THREAD_ID_IS_OUT_OF_RANGE',
  'MUTEX_LEASE_IS_NOT_ACTIVE',
  'MUTEX_LEASE_CONSTRUCTION_NOT_ALLOWED',
  'SYMBOL_DISPOSE_IS_NOT_AVAILABLE',
  'MUTEX_STATE_IS_CORRUPTED',
  'MUTEX_LOCAL_STATE_IS_INCONSISTENT',
];

function errorHasCode(error, code) {
  return error instanceof WorkerMutexError && error.code === code && error.message === code;
}

function expectThrow(callback, code) {
  let thrown = null;

  try {
    callback();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, 'Expected ' + code + ' to be thrown');
  assert.ok(errorHasCode(thrown, code), String(thrown && thrown.stack));
}

function observeWorker(worker) {
  const messages = [];
  const waiters = [];
  let exitResult = null;
  let workerError = null;

  worker.on('message', function onMessage(message) {
    let match = -1;

    for (let index = 0; index < waiters.length; index += 1) {
      if (waiters[index].predicate(message)) {
        match = index;
        break;
      }
    }

    if (match === -1) {
      messages.push(message);
      return;
    }

    const waiter = waiters.splice(match, 1)[0];
    waiter.resolve(message);
  });
  worker.on('error', function onError(error) {
    workerError = error;
  });

  const exit = new Promise(function createExitPromise(resolve) {
    worker.once('exit', function onExit(code) {
      exitResult = { code: code, error: workerError };

      while (waiters.length > 0) {
        waiters.shift().reject(workerError || new Error('WORKER_EXITED_WITH_CODE_' + code));
      }

      resolve(exitResult);
    });
  });

  function next(predicate) {
    for (let index = 0; index < messages.length; index += 1) {
      if (predicate(messages[index])) {
        return Promise.resolve(messages.splice(index, 1)[0]);
      }
    }

    if (exitResult !== null) {
      return Promise.reject(
        exitResult.error || new Error('WORKER_EXITED_WITH_CODE_' + exitResult.code)
      );
    }

    return new Promise(function createMessagePromise(resolve, reject) {
      waiters.push({ predicate: predicate, resolve: resolve, reject: reject });
    });
  }

  return { worker: worker, exit: exit, next: next };
}

function spawnScenario(action, options) {
  const data = {
    action: action,
    packageDirectory: packageDirectory,
  };

  if (options) {
    Object.keys(options).forEach(function copyOption(key) {
      data[key] = options[key];
    });
  }

  return observeWorker(new Worker(__filename, { workerData: data }));
}

async function startTracked(observed, mutexBuffer) {
  await observed.next(function isReady(message) {
    return message && message.type === 'ready';
  });
  const detach = WorkerMutex.bindWorkerExit({
    worker: observed.worker,
    sharedBuffer: mutexBuffer
  });
  observed.worker.postMessage({ type: 'start', mutexBuffer: mutexBuffer });
  return detach;
}

async function assertExit(observed, code) {
  const result = await observed.exit;
  assert.ifError(result.error);
  assert.strictEqual(result.code, code);
}

function nextParentMessage() {
  return new Promise(function waitForParent(resolve) {
    parentPort.once('message', resolve);
  });
}

async function runNestedBind(buffer) {
  const child = observeWorker(new Worker(__filename, {
    workerData: {
      action: 'idle',
      packageDirectory: packageDirectory,
    },
  }));
  await child.next(function isReady(message) {
    return message && message.type === 'ready';
  });
  let code = null;

  try {
    WorkerMutex.bindWorkerExit({ worker: child.worker, sharedBuffer: buffer });
  } catch (error) {
    code = error && error.code;
  }

  child.worker.postMessage({ type: 'stop' });
  await assertExit(child, 0);
  return code;
}

async function runWorker() {
  parentPort.postMessage({ type: 'ready' });

  if (workerData.action === 'idle') {
    const stop = await nextParentMessage();
    assert.strictEqual(stop.type, 'stop');
    return;
  }

  const start = await nextParentMessage();
  assert.strictEqual(start.type, 'start');
  activeMutexBuffer = start.mutexBuffer;
  const mutex = new WorkerMutex(start.mutexBuffer);

  if (workerData.action === 'hold-blocking') {
    mutex.lock();
    parentPort.postMessage({ type: 'owned' });
    const command = await nextParentMessage();
    assert.strictEqual(command.type, 'exit');
    process.exit(command.code);
  }

  if (workerData.action === 'once-blocking') {
    mutex.lock();
    parentPort.postMessage({ type: 'acquired' });
    mutex.unlock();
    return;
  }

  if (workerData.action === 'hold-async') {
    await mutex.acquireAsync();
    parentPort.postMessage({ type: 'owned' });
    const command = await nextParentMessage();
    assert.strictEqual(command.type, 'exit');
    process.exit(command.code);
  }

  if (workerData.action === 'nested-bind') {
    const code = await runNestedBind(start.mutexBuffer);
    parentPort.postMessage({ type: 'nested-bind', code: code });
    return;
  }

  throw new Error('UNKNOWN_ACTION_' + workerData.action);
}

async function verifyBlockingWakeAndExitCleanup() {
  const buffer = WorkerMutex.createSharedBuffer({ mode: 'BLOCKING' });
  const holder = spawnScenario('hold-blocking');
  const holderDetach = await startTracked(holder, buffer);
  await holder.next(function isOwned(message) {
    return message && message.type === 'owned';
  });

  const waiter = spawnScenario('once-blocking', { observeWait: true });
  const waiterDetach = await startTracked(waiter, buffer);
  const waitCall = await waiter.next(function isWaitCall(message) {
    return message && message.type === 'wait-called';
  });
  assert.strictEqual(typeof waitCall.timeout, 'number');
  assert.ok(isFinite(waitCall.timeout));
  assert.ok(waitCall.timeout > 0);
  holder.worker.postMessage({ type: 'exit', code: 17 });
  await assertExit(holder, 17);
  await waiter.next(function isAcquired(message) {
    return message && message.type === 'acquired';
  });
  await assertExit(waiter, 0);
  holderDetach();
  waiterDetach();
  return holder.worker;
}

async function verifyAsyncPollingAndExitCleanup() {
  const buffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  const mutex = new WorkerMutex(buffer);
  const holder = spawnScenario('hold-async');
  const detach = await startTracked(holder, buffer);
  await holder.next(function isOwned(message) {
    return message && message.type === 'owned';
  });

  let settled = false;
  const pending = mutex.acquireAsync().then(function rememberSettlement(lease) {
    settled = true;
    return lease;
  });
  await Promise.resolve();
  assert.strictEqual(settled, false);
  holder.worker.postMessage({ type: 'exit', code: 0 });
  await assertExit(holder, 0);
  const lease = await pending;
  lease.release();
  detach();
}

async function verifyWorkerSideBindingRejection() {
  const buffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  const worker = spawnScenario('nested-bind');
  const detach = await startTracked(worker, buffer);
  const result = await worker.next(function isResult(message) {
    return message && message.type === 'nested-bind';
  });
  assert.strictEqual(result.code, 'WORKER_EXIT_BINDING_REQUIRES_MAIN_THREAD');
  await assertExit(worker, 0);
  detach();
}

async function runMain() {
  assert.strictEqual(typeof WorkerMutex, 'function');
  assert.strictEqual(typeof WorkerMutexError, 'function');
  assert.strictEqual(typeof WorkerMutexErrorCodeEnum, 'object');
  assert.strictEqual(typeof WorkerMutexModeEnum, 'object');
  assert.strictEqual(typeof Symbol.dispose, 'symbol');
  const disposeDescriptor = Object.getOwnPropertyDescriptor(Symbol, 'dispose');
  assert.strictEqual(disposeDescriptor.value, Symbol.dispose);
  assert.strictEqual(disposeDescriptor.writable, false);
  assert.strictEqual(disposeDescriptor.enumerable, false);
  assert.strictEqual(disposeDescriptor.configurable, false);

  if (process.versions.node === '10.5.0') {
    assert.strictEqual(symbolDisposeBeforeRequire, 'undefined');
    assert.strictEqual(symbolAsyncDisposeBeforeRequire, 'undefined');
    assert.strictEqual(disposableStackBeforeRequire, 'undefined');
    assert.strictEqual(asyncDisposableStackBeforeRequire, 'undefined');
    assert.strictEqual(suppressedErrorBeforeRequire, 'undefined');
    assert.strictEqual(typeof Symbol.asyncDispose, 'undefined');
    assert.strictEqual(typeof global.DisposableStack, 'undefined');
    assert.strictEqual(typeof global.AsyncDisposableStack, 'undefined');
    assert.strictEqual(typeof global.SuppressedError, 'undefined');
  }
  assert.deepStrictEqual(Object.keys(WorkerMutexErrorCodeEnum), ERROR_CODES);
  assert.deepStrictEqual(Object.keys(WorkerMutexModeEnum), ['BLOCKING', 'ASYNC']);
  assert.strictEqual(WorkerMutexModeEnum.BLOCKING, 'BLOCKING');
  assert.strictEqual(WorkerMutexModeEnum.ASYNC, 'ASYNC');
  assert.strictEqual(typeof workerMutexPackage.WorkerMutexMode, 'undefined');
  assert.strictEqual(typeof workerMutexPackage.CreateSharedBufferOptions, 'undefined');
  assert.strictEqual(typeof workerMutexPackage.WorkerMutexOptions, 'undefined');

  ERROR_CODES.forEach(function assertEnumValue(code) {
    assert.strictEqual(WorkerMutexErrorCodeEnum[code], code);
  });

  assert.strictEqual(
    WorkerMutexErrorCodeEnum.MUTEX_LEASE_IS_NOT_ACTIVE,
    'MUTEX_LEASE_IS_NOT_ACTIVE'
  );
  const enumError = new WorkerMutexError(
    WorkerMutexErrorCodeEnum.MUTEX_LEASE_IS_NOT_ACTIVE
  );
  assert.strictEqual(enumError.code, 'MUTEX_LEASE_IS_NOT_ACTIVE');
  assert.strictEqual(enumError.message, enumError.code);
  const rawJavaScriptError = new WorkerMutexError('CUSTOM_RUNTIME_CODE');
  assert.strictEqual(rawJavaScriptError.code, 'CUSTOM_RUNTIME_CODE');
  assert.strictEqual(rawJavaScriptError.message, 'CUSTOM_RUNTIME_CODE');
  assert.strictEqual(typeof SharedArrayBuffer, 'function');
  assert.strictEqual(typeof Atomics.compareExchange, 'function');
  assert.strictEqual(typeof Atomics.wait, 'function');
  assert.ok(typeof Atomics.notify === 'function' || typeof Atomics.wake === 'function');

  if (process.versions.node === '10.5.0') {
    assert.strictEqual(typeof Atomics.wake, 'function');
    assert.strictEqual(typeof Atomics.notify, 'undefined');
    assert.strictEqual(typeof Atomics.waitAsync, 'undefined');
  }

  const blockingBuffer = WorkerMutex.createSharedBuffer({
    mode: WorkerMutexModeEnum.BLOCKING,
  });
  const asyncBuffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  expectThrow(function rejectLowercaseBlockingMode() {
    return WorkerMutex.createSharedBuffer({ mode: 'blocking' });
  }, 'MUTEX_MODE_MUST_BE_BLOCKING_OR_ASYNC');
  expectThrow(function rejectLowercaseAsyncMode() {
    return WorkerMutex.createSharedBuffer({ mode: 'async' });
  }, 'MUTEX_MODE_MUST_BE_BLOCKING_OR_ASYNC');
  assert.strictEqual(new WorkerMutex(asyncBuffer).sharedBuffer, asyncBuffer);
  assert.strictEqual(new WorkerMutex(blockingBuffer).mode, WorkerMutexModeEnum.BLOCKING);
  assert.strictEqual(typeof new WorkerMutex(asyncBuffer).recoverExclusive, 'undefined');
  expectThrow(function constructLegacyBuffer() {
    return new WorkerMutex(new SharedArrayBuffer(12));
  }, 'MUTEX_BUFFER_LAYOUT_IS_NOT_SUPPORTED');
  expectThrow(function constructLeaseDirectly() {
    return new WorkerMutexLease();
  }, 'MUTEX_LEASE_CONSTRUCTION_NOT_ALLOWED');

  const localMutex = new WorkerMutex(asyncBuffer);
  const first = await localMutex.acquireAsync();
  let secondSettled = false;
  const secondPending = localMutex.acquireAsync().then(function onSecond(lease) {
    secondSettled = true;
    return lease;
  });
  await Promise.resolve();
  assert.strictEqual(secondSettled, false);
  first[Symbol.dispose]();
  first[Symbol.dispose]();
  const second = await secondPending;
  second[Symbol.dispose]();
  expectThrow(function doubleRelease() {
    second.release();
  }, 'MUTEX_LEASE_IS_NOT_ACTIVE');

  const exitedWorker = await verifyBlockingWakeAndExitCleanup();
  assert.strictEqual(exitedWorker.threadId, -1);
  assert.strictEqual('exitCode' in exitedWorker, false);
  await verifyAsyncPollingAndExitCleanup();
  await verifyWorkerSideBindingRejection();
  process.stdout.write('node-10.5 smoke passed\n');
}

if (isMainThread) {
  runMain().catch(function onFailure(error) {
    process.stderr.write(String(error && error.stack ? error.stack : error) + '\n');
    process.exitCode = 1;
  });
} else {
  runWorker().catch(function onWorkerFailure(error) {
    parentPort.postMessage({
      type: 'error',
      error: String(error && error.stack ? error.stack : error),
    });
    process.exitCode = 1;
  });
}
