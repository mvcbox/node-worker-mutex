'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { after, test } = require('node:test');
const { Worker } = require('node:worker_threads');

const packageApi = require('../dist');
const {
  WorkerMutex,
  WorkerMutexError,
  WorkerMutexErrorCodeEnum,
  WorkerMutexLease,
  WorkerMutexModeEnum,
} = packageApi;
const {
  LIB_PATH,
  assertWorkerExit,
  observeWorker,
  spawnWorker,
  startTrackedWorker,
  terminateLiveWorkers,
} = require('./helpers');

const DEFAULT_TIMEOUT = 30000;
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
const MODE_ENTRIES = [
  ['BLOCKING', 'BLOCKING'],
  ['ASYNC', 'ASYNC']
];

after(async () => {
  await terminateLiveWorkers();
});

function hasCode(code) {
  return (error) => {
    assert.ok(error instanceof WorkerMutexError);
    assert.equal(error.name, 'WorkerMutexError');
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  };
}

function copySharedBuffer(source) {
  const copy = new SharedArrayBuffer(source.byteLength);
  new Uint8Array(copy).set(new Uint8Array(source));
  return copy;
}

async function runCounterWorkers(mode) {
  const workerCount = 4;
  const iterations = 250;
  const mutexBuffer = WorkerMutex.createSharedBuffer({ mode });
  const counterBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const counter = new Int32Array(counterBuffer);
  const workers = Array.from({ length: workerCount }, () => spawnWorker(
    'counter.worker.js',
    {
      libPath: LIB_PATH,
      counterBuffer,
      iterations,
      mode,
    }
  ));
  const detachers = [];

  for (const observed of workers) {
    await observed.next((message) => message && message.type === 'ready');
    detachers.push(WorkerMutex.bindWorkerExit({
      worker: observed.worker,
      sharedBuffer: mutexBuffer
    }));
  }

  for (const observed of workers) {
    observed.worker.postMessage({ type: 'start', mutexBuffer });
  }

  for (const observed of workers) {
    const result = await observed.next((message) => (
      message && (message.type === 'done' || message.type === 'error')
    ));
    assert.equal(result.type, 'done', result.error);
  }

  for (const observed of workers) {
    await assertWorkerExit(observed, 0);
  }

  for (const detach of detachers) {
    detach();
  }

  assert.equal(counter[0], workerCount * iterations);
}

async function runCapabilityCase(scenario) {
  const observed = spawnWorker('capability.worker.js', {
    libPath: LIB_PATH,
    scenario,
  });
  const result = await observed.next((message) => message && message.type === 'result');
  await assertWorkerExit(observed, 0);
  return result;
}

test('exports a complete string error-code enum with stable values', () => {
  assert.deepEqual(Object.keys(WorkerMutexErrorCodeEnum), ERROR_CODES);
  assert.deepEqual(Object.values(WorkerMutexErrorCodeEnum), ERROR_CODES);
  assert.equal(
    WorkerMutexErrorCodeEnum.MUTEX_STATE_IS_CORRUPTED,
    'MUTEX_STATE_IS_CORRUPTED'
  );

  const typed = new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_LEASE_IS_NOT_ACTIVE);
  assert.ok(typed instanceof WorkerMutexError);
  assert.equal(typed.name, 'WorkerMutexError');
  assert.equal(typed.code, 'MUTEX_LEASE_IS_NOT_ACTIVE');
  assert.equal(typed.message, typed.code);

  const rawJavaScript = new WorkerMutexError('CUSTOM_RUNTIME_CODE');
  assert.equal(rawJavaScript.code, 'CUSTOM_RUNTIME_CODE');
  assert.equal(rawJavaScript.message, 'CUSTOM_RUNTIME_CODE');
});

test('exports the exact runtime mode enum without the legacy mode export', () => {
  assert.deepEqual(Object.entries(WorkerMutexModeEnum), MODE_ENTRIES);
  assert.equal(WorkerMutexModeEnum.BLOCKING, 'BLOCKING');
  assert.equal(WorkerMutexModeEnum.ASYNC, 'ASYNC');
  assert.equal(Object.prototype.hasOwnProperty.call(packageApi, 'WorkerMutexMode'), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(packageApi, 'CreateSharedBufferOptions'),
    false
  );
  assert.equal(Object.prototype.hasOwnProperty.call(packageApi, 'WorkerMutexOptions'), false);
});

test('creates usable buffers with explicit modes', async () => {
  assert.throws(
    () => WorkerMutex.createSharedBuffer(),
    hasCode('MUTEX_MODE_MUST_BE_BLOCKING_OR_ASYNC')
  );
  assert.throws(
    () => WorkerMutex.createSharedBuffer({}),
    hasCode('MUTEX_MODE_MUST_BE_BLOCKING_OR_ASYNC')
  );
  assert.throws(
    () => WorkerMutex.createSharedBuffer({ mode: 'mixed' }),
    hasCode('MUTEX_MODE_MUST_BE_BLOCKING_OR_ASYNC')
  );
  assert.throws(
    () => WorkerMutex.createSharedBuffer({ mode: 'blocking' }),
    hasCode('MUTEX_MODE_MUST_BE_BLOCKING_OR_ASYNC')
  );
  assert.throws(
    () => WorkerMutex.createSharedBuffer({ mode: 'async' }),
    hasCode('MUTEX_MODE_MUST_BE_BLOCKING_OR_ASYNC')
  );

  const blocking = WorkerMutex.createSharedBuffer({ mode: WorkerMutexModeEnum.BLOCKING });
  const asyncBuffer = WorkerMutex.createSharedBuffer({ mode: WorkerMutexModeEnum.ASYNC });

  assert.ok(blocking instanceof SharedArrayBuffer);

  const blockingMutex = new WorkerMutex(blocking);
  const asyncMutex = new WorkerMutex(asyncBuffer);
  assert.equal(blockingMutex.sharedBuffer, blocking);
  assert.equal(blockingMutex.mode, WorkerMutexModeEnum.BLOCKING);
  assert.equal(asyncMutex.mode, WorkerMutexModeEnum.ASYNC);

  const lease = await asyncMutex.acquireAsync();
  assert.equal(lease.released, false);
  lease.release();
});

test('rejects legacy, malformed, future, corrupt, invalid-id, and spoofed buffers without mutation', () => {
  const valid = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  assert.throws(
    () => new WorkerMutex(new ArrayBuffer(valid.byteLength)),
    hasCode('HANDLE_MUST_BE_A_SHARED_ARRAY_BUFFER')
  );
  assert.throws(
    () => new WorkerMutex({ byteLength: valid.byteLength }),
    hasCode('HANDLE_MUST_BE_A_SHARED_ARRAY_BUFFER')
  );
  assert.throws(
    () => new WorkerMutex(new SharedArrayBuffer(12)),
    hasCode('MUTEX_BUFFER_LAYOUT_IS_NOT_SUPPORTED')
  );
  assert.throws(
    () => new WorkerMutex(new SharedArrayBuffer(36)),
    hasCode('MUTEX_BUFFER_SIZE_MUST_MATCH_SINGLE_MUTEX')
  );

  for (const [index, value, code] of [
    [0, 0, 'MUTEX_BUFFER_LAYOUT_IS_NOT_SUPPORTED'],
    [1, 3, 'MUTEX_BUFFER_LAYOUT_IS_NOT_SUPPORTED'],
    [2, 99, 'MUTEX_BUFFER_LAYOUT_IS_NOT_SUPPORTED'],
    [7, -2, 'MUTEX_STATE_IS_CORRUPTED'],
  ]) {
    const malformed = copySharedBuffer(valid);
    new Int32Array(malformed)[index] = value;
    const before = new Uint8Array(malformed).slice();
    assert.throws(() => new WorkerMutex(malformed), hasCode(code));
    assert.deepEqual(new Uint8Array(malformed), before);
  }

  const invalidId = copySharedBuffer(valid);
  new Int32Array(invalidId).fill(0, 3, 7);
  assert.throws(
    () => new WorkerMutex(invalidId),
    hasCode('MUTEX_BUFFER_ID_IS_INVALID')
  );
});

test('accepts valid cross-realm and structured-clone SharedArrayBuffer wrappers', async (t) => {
  const source = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  const crossRealm = vm.runInNewContext(`new SharedArrayBuffer(${source.byteLength})`);
  new Uint8Array(crossRealm).set(new Uint8Array(source));
  assert.equal(new WorkerMutex(crossRealm).sharedBuffer, crossRealm);

  if (typeof structuredClone !== 'function') {
    t.skip('structuredClone is unavailable in this development runtime');
    return;
  }

  const clonedWrapper = structuredClone(source);
  const firstMutex = new WorkerMutex(source);
  const secondMutex = new WorkerMutex(clonedWrapper);
  const first = await firstMutex.acquireAsync();
  let secondSettled = false;
  const secondPending = secondMutex.acquireAsync().then((lease) => {
    secondSettled = true;
    return lease;
  });
  await Promise.resolve();
  assert.equal(secondSettled, false);
  first.release();
  const second = await secondPending;
  second.release();
});

test('rejects growable SharedArrayBuffer handles when available', (t) => {
  const source = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  let growable;

  try {
    growable = new SharedArrayBuffer(source.byteLength, { maxByteLength: 80 });
  } catch (_error) {
    t.skip('Growable SharedArrayBuffer is unavailable in this runtime');
    return;
  }

  if (growable.growable !== true) {
    t.skip('Growable SharedArrayBuffer is unavailable in this runtime');
    return;
  }

  new Uint8Array(growable).set(new Uint8Array(source));
  assert.throws(
    () => new WorkerMutex(growable),
    hasCode('MUTEX_BUFFER_MUST_NOT_BE_GROWABLE')
  );
});

test('enforces mode-specific APIs and removes legacy poison and lockAsync contracts', async () => {
  const blocking = new WorkerMutex(WorkerMutex.createSharedBuffer({ mode: 'BLOCKING' }));
  const asyncMutex = new WorkerMutex(WorkerMutex.createSharedBuffer({ mode: 'ASYNC' }));

  await assert.rejects(
    () => blocking.acquireAsync(),
    hasCode('MUTEX_MODE_DOES_NOT_SUPPORT_ASYNC')
  );
  await assert.rejects(
    () => blocking.runExclusive(() => undefined),
    hasCode('MUTEX_MODE_DOES_NOT_SUPPORT_ASYNC')
  );
  assert.throws(
    () => asyncMutex.lock(),
    hasCode('MUTEX_MODE_DOES_NOT_SUPPORT_BLOCKING')
  );
  assert.throws(
    () => asyncMutex.unlock(),
    hasCode('MUTEX_MODE_DOES_NOT_SUPPORT_BLOCKING')
  );
  assert.equal(typeof asyncMutex.lockAsync, 'undefined');
  assert.equal(typeof asyncMutex.recoverExclusive, 'undefined');
  assert.throws(
    () => new WorkerMutexLease(),
    hasCode('MUTEX_LEASE_CONSTRUCTION_NOT_ALLOWED')
  );
});

test('rejects blocking lock on the main thread', () => {
  const buffer = WorkerMutex.createSharedBuffer({ mode: 'BLOCKING' });
  const mutex = new WorkerMutex(buffer);
  assert.throws(() => mutex.lock(), hasCode('MUTEX_BLOCKING_LOCK_NOT_ALLOWED'));
  assert.throws(() => mutex.unlock(), hasCode('MUTEX_IS_NOT_OWNED_BY_CURRENT_THREAD'));
});

test('serializes many local async critical sections', { timeout: DEFAULT_TIMEOUT }, async () => {
  const mutex = new WorkerMutex(WorkerMutex.createSharedBuffer({ mode: 'ASYNC' }));
  const holder = await mutex.acquireAsync();
  const count = 5000;
  let completed = 0;
  let active = 0;
  let maxActive = 0;
  const queued = Array.from({ length: count }, () => mutex.runExclusive(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    completed += 1;
    active -= 1;
  }));

  await Promise.resolve();
  assert.equal(completed, 0);
  holder.release();
  await Promise.all(queued);
  assert.equal(maxActive, 1);
  assert.equal(completed, count);
});

test('auto-releases runExclusive and rejects stale or double lease release', async () => {
  const mutex = new WorkerMutex(WorkerMutex.createSharedBuffer({ mode: 'ASYNC' }));
  const lease = await mutex.acquireAsync();
  assert.equal(lease.released, false);
  lease.release();
  assert.equal(lease.released, true);
  const nextLease = await mutex.acquireAsync();
  assert.throws(() => lease.release(), hasCode('MUTEX_LEASE_IS_NOT_ACTIVE'));
  assert.equal(nextLease.released, false);
  nextLease.release();

  const marker = new Error('CALLBACK_FAILED');
  let callbackLease;
  await assert.rejects(
    () => mutex.runExclusive((current) => {
      callbackLease = current;
      throw marker;
    }),
    (error) => error === marker
  );
  assert.equal(callbackLease.released, true);

  const returned = await mutex.runExclusive((current) => {
    current.release();
    return 42;
  });
  assert.equal(returned, 42);

  assert.equal(await mutex.runExclusive(() => Promise.resolve(43)), 43);
  const rejected = new Error('ASYNC_CALLBACK_FAILED');
  await assert.rejects(
    () => mutex.runExclusive(() => Promise.reject(rejected)),
    (error) => error === rejected
  );
  const afterRejection = await mutex.acquireAsync();
  afterRejection.release();
});

test('disposes async leases without releasing a later owner', async () => {
  const mutex = new WorkerMutex(WorkerMutex.createSharedBuffer({ mode: 'ASYNC' }));
  const first = await mutex.acquireAsync();
  const pending = mutex.acquireAsync();

  first[Symbol.dispose]();
  assert.equal(first.released, true);
  const second = await pending;
  first[Symbol.dispose]();
  assert.equal(second.released, false);
  second.release();
  second[Symbol.dispose]();
  assert.throws(() => second.release(), hasCode('MUTEX_LEASE_IS_NOT_ACTIVE'));
});

test('covers non-owner unlock, partial recursion release, underflow, and overflow', { timeout: DEFAULT_TIMEOUT }, async () => {
  const ownedBuffer = WorkerMutex.createSharedBuffer({ mode: 'BLOCKING' });
  const actualOwner = spawnWorker('scenario.worker.js', {
    libPath: LIB_PATH,
    mode: 'BLOCKING',
    scenario: 'hold',
  });
  const actualOwnerDetach = await startTrackedWorker(actualOwner, ownedBuffer);
  await actualOwner.next((message) => message && message.type === 'owned');
  const nonowner = spawnWorker('scenario.worker.js', {
    libPath: LIB_PATH,
    scenario: 'unlock-only',
  });
  const nonownerDetach = await startTrackedWorker(nonowner, ownedBuffer);
  const nonownerResult = await nonowner.next((message) => message && message.type === 'unlock-only');
  assert.equal(nonownerResult.code, 'MUTEX_IS_NOT_OWNED_BY_CURRENT_THREAD');
  await assertWorkerExit(nonowner, 0);
  actualOwner.worker.postMessage({ type: 'release' });
  await actualOwner.next((message) => message && message.type === 'released');
  await assertWorkerExit(actualOwner, 0);
  actualOwnerDetach();
  nonownerDetach();

  const buffer = WorkerMutex.createSharedBuffer({ mode: 'BLOCKING' });
  const owner = spawnWorker('scenario.worker.js', {
    libPath: LIB_PATH,
    scenario: 'blocking-errors',
  });
  const ownerDetach = await startTrackedWorker(owner, buffer);
  const result = await owner.next((message) => message && message.type === 'blocking-errors');
  assert.equal(result.nonownerCode, 'MUTEX_IS_NOT_OWNED_BY_CURRENT_THREAD');

  const waiter = spawnWorker('scenario.worker.js', {
    libPath: LIB_PATH,
    mode: 'BLOCKING',
    observeWait: true,
    scenario: 'wait-once',
  });
  const waiterDetach = await startTrackedWorker(waiter, buffer);
  await waiter.next((message) => message && message.type === 'wait-called');
  owner.worker.postMessage({ type: 'release' });
  await owner.next((message) => message && message.type === 'released');
  await waiter.next((message) => message && message.type === 'acquired');
  await assertWorkerExit(owner, 0);
  await assertWorkerExit(waiter, 0);
  ownerDetach();
  waiterDetach();

  const errorBuffer = WorkerMutex.createSharedBuffer({ mode: 'BLOCKING' });
  const errors = spawnWorker('scenario.worker.js', {
    libPath: LIB_PATH,
    scenario: 'recursion-errors',
  });
  const errorsDetach = await startTrackedWorker(errors, errorBuffer);
  const recursion = await errors.next((message) => message && message.type === 'recursion-errors');
  assert.equal(recursion.underflowCode, 'MUTEX_RECURSION_COUNT_UNDERFLOW');
  assert.equal(recursion.overflowCode, 'MUTEX_RECURSION_COUNT_OVERFLOW');
  await assertWorkerExit(errors, 0);
  errorsDetach();
});

test('serializes blocking critical sections across workers', { timeout: DEFAULT_TIMEOUT }, async () => {
  await runCounterWorkers('BLOCKING');
});

test('serializes async critical sections across workers', { timeout: DEFAULT_TIMEOUT }, async () => {
  await runCounterWorkers('ASYNC');
});

test('enforces post-bind start barrier before a worker receives the mutex handle', { timeout: DEFAULT_TIMEOUT }, async () => {
  const buffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  const markerBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const marker = new Int32Array(markerBuffer);
  const worker = spawnWorker('scenario.worker.js', {
    libPath: LIB_PATH,
    markerBuffer,
    mode: 'ASYNC',
    scenario: 'hold',
  });
  await worker.next((message) => message && message.type === 'ready');
  assert.equal(Atomics.load(marker, 0), 0);
  const detach = WorkerMutex.bindWorkerExit({
    worker: worker.worker,
    sharedBuffer: buffer
  });
  worker.worker.postMessage({ type: 'start', mutexBuffer: buffer });
  await worker.next((message) => message && message.type === 'owned');
  assert.equal(Atomics.load(marker, 0), 1);
  worker.worker.postMessage({ type: 'release' });
  await worker.next((message) => message && message.type === 'released');
  await assertWorkerExit(worker, 0);
  detach();
});

test('requires a genuine Worker and rejects an already-exited Worker without exitCode', { timeout: DEFAULT_TIMEOUT }, async () => {
  const buffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  assert.throws(
    () => WorkerMutex.bindWorkerExit(),
    hasCode('WORKER_INSTANCE_MUST_SUPPORT_EXIT_EVENT')
  );
  assert.throws(
    () => WorkerMutex.bindWorkerExit(null),
    hasCode('WORKER_INSTANCE_MUST_SUPPORT_EXIT_EVENT')
  );
  assert.throws(
    () => WorkerMutex.bindWorkerExit({ worker: null, sharedBuffer: buffer }),
    hasCode('WORKER_INSTANCE_MUST_SUPPORT_EXIT_EVENT')
  );
  assert.throws(
    () => WorkerMutex.bindWorkerExit({
      worker: { threadId: 1, once() {} },
      sharedBuffer: buffer
    }),
    hasCode('WORKER_INSTANCE_MUST_SUPPORT_EXIT_EVENT')
  );

  const exited = observeWorker(new Worker('', { eval: true }));
  await assertWorkerExit(exited, 0);
  assert.equal(exited.worker.threadId, -1);
  assert.equal('exitCode' in exited.worker, false);
  assert.throws(
    () => WorkerMutex.bindWorkerExit({ worker: exited.worker, sharedBuffer: buffer }),
    hasCode('WORKER_IS_ALREADY_EXITED')
  );
});

test('rejects nested worker-side exit binding before inspecting its arguments', { timeout: DEFAULT_TIMEOUT }, async () => {
  const buffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  const worker = spawnWorker('scenario.worker.js', {
    libPath: LIB_PATH,
    scenario: 'nested-bind',
  });
  const detach = await startTrackedWorker(worker, buffer);
  const result = await worker.next((message) => message && message.type === 'nested-bind');
  assert.equal(result.code, 'WORKER_EXIT_BINDING_REQUIRES_MAIN_THREAD');
  await assertWorkerExit(worker, 0);
  detach();
});

test('fails fast with typed errors for absent, malformed, or throwing runtime capabilities', { timeout: DEFAULT_TIMEOUT }, async () => {
  const typedCases = [
    ['shared-null', 'SHARED_ARRAY_BUFFER_IS_NOT_AVAILABLE'],
    ['shared-noncallable', 'SHARED_ARRAY_BUFFER_IS_NOT_AVAILABLE'],
    ['shared-missing-byte-length', 'SHARED_ARRAY_BUFFER_IS_NOT_AVAILABLE'],
    ['atomics-null', 'REQUIRED_ATOMICS_OPERATIONS_ARE_NOT_AVAILABLE'],
    ['atomics-noncallable', 'REQUIRED_ATOMICS_OPERATIONS_ARE_NOT_AVAILABLE'],
    ['atomics-throwing', 'REQUIRED_ATOMICS_OPERATIONS_ARE_NOT_AVAILABLE'],
    ['wake-null', 'REQUIRED_ATOMICS_OPERATIONS_ARE_NOT_AVAILABLE'],
    ['wake-throwing', 'REQUIRED_ATOMICS_OPERATIONS_ARE_NOT_AVAILABLE'],
    ['timer-null', 'REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE'],
    ['timer-noncallable', 'REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE'],
    ['timer-throwing', 'REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE'],
    ['timer-bad-handle', 'REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE'],
    ['timer-handle-noncallable', 'REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE'],
    ['timer-handle-ref-throwing', 'REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE'],
    ['timer-handle-unref-throwing', 'REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE'],
    ['hrtime-null', 'REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE'],
    ['hrtime-invalid', 'REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE'],
    ['crypto-null', 'CRYPTO_RANDOM_IS_NOT_AVAILABLE'],
    ['crypto-noncallable', 'CRYPTO_RANDOM_IS_NOT_AVAILABLE'],
    ['crypto-throwing', 'CRYPTO_RANDOM_IS_NOT_AVAILABLE'],
    ['crypto-short', 'CRYPTO_RANDOM_IS_NOT_AVAILABLE'],
    ['crypto-zero', 'CRYPTO_RANDOM_IS_NOT_AVAILABLE'],
    ['worker-missing', 'WORKER_THREADS_ARE_NOT_AVAILABLE'],
    ['worker-null', 'WORKER_THREADS_ARE_NOT_AVAILABLE'],
    ['worker-noncallable', 'WORKER_THREADS_ARE_NOT_AVAILABLE'],
    ['worker-missing-thread-id-getter', 'WORKER_THREADS_ARE_NOT_AVAILABLE'],
    ['symbol-dispose-non-symbol', 'SYMBOL_DISPOSE_IS_NOT_AVAILABLE'],
    ['symbol-dispose-accessor', 'SYMBOL_DISPOSE_IS_NOT_AVAILABLE'],
    ['symbol-dispose-inherited', 'SYMBOL_DISPOSE_IS_NOT_AVAILABLE'],
    ['registry-incompatible', 'WORKER_MUTEX_REGISTRY_IS_INCOMPATIBLE'],
  ];

  for (const [scenario, code] of typedCases) {
    const result = await runCapabilityCase(scenario);
    assert.equal(result.ok, false, scenario);
    assert.equal(result.name, 'WorkerMutexError', scenario);
    assert.equal(result.code, code, scenario);
    assert.equal(result.message, code, scenario);
  }

  for (const scenario of [
    'notify-throwing-wake-works',
    'wait-async-throwing',
    'wait-async-never-settles'
  ]) {
    const result = await runCapabilityCase(scenario);
    assert.equal(result.ok, true, `${scenario}: ${result.message || ''}`);
  }
});
