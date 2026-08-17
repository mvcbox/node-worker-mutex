'use strict';

const { parentPort, workerData } = require('worker_threads');
const Module = require('module');
const vm = require('vm');

function replace(target, property, value) {
  try {
    Object.defineProperty(target, property, {
      configurable: true,
      value,
      writable: true,
    });
  } catch (_error) {
    target[property] = value;
  }
}

function throwingCapability() {
  throw new Error('INJECTED_CAPABILITY_FAILURE');
}

function createSymbolConstructor() {
  const nativeSymbol = Symbol;

  function SymbolConstructor(description) {
    return nativeSymbol(description);
  }

  SymbolConstructor.for = nativeSymbol.for;
  return SymbolConstructor;
}

function configure() {
  const scenario = workerData.scenario;

  if (scenario === 'shared-null') {
    global.SharedArrayBuffer = null;
  } else if (scenario === 'shared-noncallable') {
    global.SharedArrayBuffer = {};
  } else if (scenario === 'shared-missing-byte-length') {
    global.SharedArrayBuffer = function SharedArrayBufferWithoutByteLength() {};
  } else if (scenario === 'atomics-null') {
    replace(Atomics, 'compareExchange', null);
  } else if (scenario === 'atomics-noncallable') {
    replace(Atomics, 'load', {});
  } else if (scenario === 'atomics-throwing') {
    replace(Atomics, 'store', throwingCapability);
  } else if (scenario === 'wake-null') {
    replace(Atomics, 'notify', null);
    replace(Atomics, 'wake', null);
  } else if (scenario === 'wake-throwing') {
    replace(Atomics, 'notify', throwingCapability);
    replace(Atomics, 'wake', throwingCapability);
  } else if (scenario === 'notify-throwing-wake-works') {
    const nativeNotify = Atomics.notify;
    replace(Atomics, 'notify', throwingCapability);
    replace(Atomics, 'wake', function wake(array, index, count) {
      return nativeNotify.call(Atomics, array, index, count);
    });
  } else if (scenario === 'wait-async-throwing') {
    replace(Atomics, 'waitAsync', throwingCapability);
  } else if (scenario === 'wait-async-never-settles') {
    replace(Atomics, 'waitAsync', function waitAsyncNeverSettles() {
      return { async: true, value: new Promise(() => {}) };
    });
  } else if (scenario === 'timer-null') {
    global.setTimeout = null;
  } else if (scenario === 'timer-noncallable') {
    global.clearTimeout = {};
  } else if (scenario === 'timer-throwing') {
    global.setTimeout = throwingCapability;
  } else if (scenario === 'timer-bad-handle') {
    global.setTimeout = function setTimeoutBadHandle() {
      return null;
    };
  } else if (scenario === 'timer-handle-noncallable') {
    global.setTimeout = function setTimeoutIncompleteHandle() {
      return { ref: function ref() {}, unref: function unref() {} };
    };
  } else if (scenario === 'timer-handle-ref-throwing') {
    global.setTimeout = function setTimeoutThrowingRef() {
      return {
        ref: throwingCapability,
        refresh: function refresh() {},
        unref: function unref() {},
      };
    };
    global.clearTimeout = function clearTimeoutFakeHandle() {};
  } else if (scenario === 'timer-handle-unref-throwing') {
    global.setTimeout = function setTimeoutThrowingUnref() {
      return {
        ref: function ref() {},
        refresh: function refresh() {},
        unref: throwingCapability,
      };
    };
    global.clearTimeout = function clearTimeoutFakeHandle() {};
  } else if (scenario === 'hrtime-null') {
    replace(process, 'hrtime', null);
  } else if (scenario === 'hrtime-invalid') {
    replace(process, 'hrtime', function invalidHrtime() {
      return [0];
    });
  } else if (
    scenario === 'crypto-null' ||
    scenario === 'crypto-noncallable' ||
    scenario === 'crypto-throwing' ||
    scenario === 'crypto-short' ||
    scenario === 'crypto-zero'
  ) {
    const crypto = require('crypto');
    let randomBytes;

    if (scenario === 'crypto-null') {
      randomBytes = null;
    } else if (scenario === 'crypto-noncallable') {
      randomBytes = {};
    } else if (scenario === 'crypto-short') {
      randomBytes = function shortRandomBytes() {
        return Buffer.alloc(15);
      };
    } else if (scenario === 'crypto-zero') {
      randomBytes = function zeroRandomBytes() {
        return Buffer.alloc(16);
      };
    } else {
      randomBytes = throwingCapability;
    }

    replace(
      crypto,
      'randomBytes',
      randomBytes
    );
  } else if (scenario === 'symbol-dispose-non-symbol') {
    const symbolConstructor = createSymbolConstructor();
    Object.defineProperty(symbolConstructor, 'dispose', { value: 'dispose' });
    global.Symbol = symbolConstructor;
  } else if (scenario === 'symbol-dispose-accessor') {
    const symbolConstructor = createSymbolConstructor();
    Object.defineProperty(symbolConstructor, 'dispose', {
      get: throwingCapability
    });
    global.Symbol = symbolConstructor;
  } else if (scenario === 'symbol-dispose-inherited') {
    const symbolConstructor = createSymbolConstructor();
    const prototype = Object.create(Object.getPrototypeOf(symbolConstructor));
    Object.defineProperty(prototype, 'dispose', { value: Symbol('inherited.dispose') });
    Object.setPrototypeOf(symbolConstructor, prototype);
    global.Symbol = symbolConstructor;
  }

  if (
    scenario === 'worker-missing' ||
    scenario === 'worker-null' ||
    scenario === 'worker-noncallable' ||
    scenario === 'worker-missing-thread-id-getter'
  ) {
    const nativeLoad = Module._load;
    Module._load = function load(request, parent, isMain) {
      if (request === 'worker_threads' || request === 'node:worker_threads') {
        if (scenario === 'worker-missing') {
          throw new Error('INJECTED_WORKER_THREADS_LOAD_FAILURE');
        }

        if (scenario === 'worker-null') {
          return null;
        }

        if (scenario === 'worker-missing-thread-id-getter') {
          return {
            Worker: function WorkerWithoutThreadIdGetter() {},
            isMainThread: true,
            threadId: 0
          };
        }

        return { Worker: {}, isMainThread: true, threadId: 0 };
      }

      return nativeLoad.call(this, request, parent, isMain);
    };
  }

  if (scenario === 'registry-incompatible') {
    process[Symbol.for('worker-mutex.isolate-registry')] = vm.runInNewContext(`({
      abiVersion: 5,
      mutexes: new Map(),
      workers: new WeakMap(),
      pollHeap: [],
      pollIndex: new Map(),
      pendingAsyncRequests: 0,
      keeperTimer: undefined,
      pollTimer: undefined,
      pollTimerDeadline: 0,
      pollTimerToken: 0,
      nextPollSequence: 0
    })`);
  }
}

async function exercise(WorkerMutex) {
  const scenario = workerData.scenario;
  const buffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  const mutex = new WorkerMutex(buffer);

  if (scenario === 'timer-throwing') {
    await mutex.acquireAsync();
    return;
  }

  if (scenario === 'wake-throwing') {
    const lease = await mutex.acquireAsync();
    lease.release();
    return;
  }

  if (scenario === 'wait-async-throwing') {
    const cells = new Int32Array(buffer);
    cells[7] = 2147483646;
    const pending = mutex.acquireAsync();
    setImmediate(() => {
      Atomics.store(cells, 7, 0);
    });
    const lease = await pending;
    lease.release();
    return;
  }

  if (scenario === 'wait-async-never-settles') {
    const cells = new Int32Array(buffer);
    cells[7] = 2147483646;
    const pending = mutex.acquireAsync();
    setImmediate(() => {
      Atomics.store(cells, 7, 0);
    });
    let timeout;

    try {
      const lease = await Promise.race([
        pending,
        new Promise((resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('WAIT_ASYNC_WATCHDOG_DID_NOT_PROGRESS')), 2500);
        }),
      ]);
      lease.release();
    } finally {
      clearTimeout(timeout);
    }

    return;
  }

  if (scenario === 'registry-incompatible') {
    let pending;

    try {
      pending = mutex.acquireAsync();
    } catch (_error) {
      throw new Error('ACQUIRE_ASYNC_THROWN_SYNCHRONOUSLY');
    }

    await pending;
    return;
  }

  const lease = await mutex.acquireAsync();
  lease.release();
}

async function run() {
  configure();
  let result;

  try {
    const { WorkerMutex } = require(workerData.libPath);
    await exercise(WorkerMutex);
    result = { type: 'result', ok: true };
  } catch (error) {
    result = {
      type: 'result',
      ok: false,
      code: error && error.code,
      name: error && error.name,
      message: error && error.message,
    };
  }

  parentPort.postMessage(result);
}

run().catch((error) => {
  parentPort.postMessage({
    type: 'error',
    error: error && error.stack ? error.stack : String(error),
  });
  process.exitCode = 1;
});
