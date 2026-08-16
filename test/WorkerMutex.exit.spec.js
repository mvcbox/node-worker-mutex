'use strict';

const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { Worker } = require('node:worker_threads');

const { WorkerMutex, WorkerMutexError } = require('../dist');
const {
  LIB_PATH,
  assertWorkerExit,
  observeWorker,
  spawnWorker,
  startTrackedWorker,
  terminateLiveWorkers
} = require('./helpers');

const DEFAULT_TIMEOUT = 30000;

after(async () => {
  await terminateLiveWorkers();
});

function hasCode(code) {
  return (error) => {
    assert.ok(error instanceof WorkerMutexError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  };
}

function createIdleWorker() {
  return observeWorker(new Worker(
    "const { parentPort } = require('worker_threads'); parentPort.once('message', () => {}); parentPort.postMessage('ready');",
    { eval: true }
  ));
}

test('supports duplicate bindings, idempotent disposers, and cleanup of multiple mutexes', { timeout: DEFAULT_TIMEOUT }, async () => {
  const buffers = [
    WorkerMutex.createSharedBuffer({ mode: 'ASYNC' }),
    WorkerMutex.createSharedBuffer({ mode: 'ASYNC' }),
    WorkerMutex.createSharedBuffer({ mode: 'ASYNC' })
  ];
  const owner = spawnWorker('multi-owner.worker.js', { libPath: LIB_PATH });
  await owner.next((message) => message && message.type === 'ready');
  const disposeFirst = WorkerMutex.bindWorkerExit({
    worker: owner.worker,
    sharedBuffer: buffers[0]
  });
  const disposeDuplicate = WorkerMutex.bindWorkerExit({
    worker: owner.worker,
    sharedBuffer: buffers[0]
  });
  const disposeSecond = WorkerMutex.bindWorkerExit({
    worker: owner.worker,
    sharedBuffer: buffers[1]
  });
  const disposeFree = WorkerMutex.bindWorkerExit({
    worker: owner.worker,
    sharedBuffer: buffers[2]
  });
  disposeFirst();
  disposeFirst();

  owner.worker.postMessage({ type: 'start', mutexBuffers: buffers.slice(0, 2) });
  await owner.next((message) => message && message.type === 'owned');
  const pending = buffers.map((buffer) => new WorkerMutex(buffer).acquireAsync());
  owner.worker.postMessage({ type: 'exit', code: 0 });
  await assertWorkerExit(owner, 0);
  const leases = await Promise.all(pending);

  for (const lease of leases) {
    lease.release();
  }

  disposeDuplicate();
  disposeSecond();
  disposeFree();
});

test('disposes a live worker binding idempotently without disrupting the worker', { timeout: DEFAULT_TIMEOUT }, async () => {
  const buffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  const worker = createIdleWorker();
  await worker.next((message) => message === 'ready');
  const exitListenerBaseline = worker.worker.listenerCount('exit');
  const dispose = WorkerMutex.bindWorkerExit({
    worker: worker.worker,
    sharedBuffer: buffer
  });

  assert.equal(worker.worker.listenerCount('exit'), exitListenerBaseline + 1);
  dispose();
  assert.equal(worker.worker.listenerCount('exit'), exitListenerBaseline);
  dispose();
  assert.equal(worker.worker.listenerCount('exit'), exitListenerBaseline);
  worker.worker.postMessage('stop');
  await assertWorkerExit(worker, 0);
});

test('ignores synthetic exit emission, retains cleanup listener, and releases on genuine exit', { timeout: DEFAULT_TIMEOUT }, async () => {
  const buffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  const mutex = new WorkerMutex(buffer);
  const owner = spawnWorker('scenario.worker.js', {
    libPath: LIB_PATH,
    mode: 'ASYNC',
    scenario: 'hold',
  });
  const detach = await startTrackedWorker(owner, buffer);
  await owner.next((message) => message && message.type === 'owned');
  owner.worker.emit('exit', 99);

  let acquired = false;
  const pending = mutex.acquireAsync().then((lease) => {
    acquired = true;
    return lease;
  });
  await Promise.resolve();
  assert.equal(acquired, false);
  owner.worker.postMessage({ type: 'exit', code: 0 });
  await assertWorkerExit(owner, 0);
  const lease = await pending;
  assert.equal(acquired, true);
  lease.release();
  detach();
});

test('auto-releases async ownership for self-exit code 0 and nonzero exit', { timeout: DEFAULT_TIMEOUT }, async () => {
  for (const exitCode of [0, 17]) {
    const buffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
    const cells = new Int32Array(buffer);
    const mutex = new WorkerMutex(buffer);
    const owner = spawnWorker('scenario.worker.js', {
      libPath: LIB_PATH,
      mode: 'ASYNC',
      scenario: 'hold',
    });
    const detach = await startTrackedWorker(owner, buffer);
    await owner.next((message) => message && message.type === 'owned');
    const pending = mutex.acquireAsync();
    owner.worker.postMessage({ type: 'exit', code: exitCode });
    await assertWorkerExit(owner, exitCode);
    const lease = await pending;
    assert.equal(Atomics.load(cells, 8), 1);
    lease.release();
    assert.equal(Atomics.load(cells, 7), 0);
    assert.equal(Atomics.load(cells, 8), 0);
    detach();
  }
});

test('terminate after acquisition CAS releases an exactly matched owner', { timeout: DEFAULT_TIMEOUT }, async () => {
  const buffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  const cells = new Int32Array(buffer);
  const controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const mutex = new WorkerMutex(buffer);
  const owner = spawnWorker('scenario.worker.js', {
    controlBuffer,
    libPath: LIB_PATH,
    mode: 'ASYNC',
    pauseAfterAcquireCas: true,
    scenario: 'hold',
  });
  const detach = await startTrackedWorker(owner, buffer);
  await owner.next((message) => message && message.type === 'after-acquire-cas');
  let settled = false;
  const pending = mutex.acquireAsync().then((lease) => {
    settled = true;
    return lease;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.ok(Atomics.load(cells, 7) > 1);
  assert.equal(Atomics.load(cells, 8), 0);
  await owner.worker.terminate();
  const exit = await owner.exit;
  assert.equal(exit.error, null);
  const lease = await pending;
  lease.release();
  assert.equal(Atomics.load(cells, 7), 0);
  assert.equal(Atomics.load(cells, 8), 0);
  detach();
});

test('rollback never publishes an owner state that exit cleanup cannot reclaim', { timeout: DEFAULT_TIMEOUT }, async () => {
  const buffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  const cells = new Int32Array(buffer);
  const controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const mutex = new WorkerMutex(buffer);
  const owner = spawnWorker('scenario.worker.js', {
    controlBuffer,
    failRecursionStoreAfterAcquire: true,
    libPath: LIB_PATH,
    mode: 'ASYNC',
    pauseAfterRollbackCas: true,
    scenario: 'hold',
  });
  const detach = await startTrackedWorker(owner, buffer);
  const rollback = await owner.next((message) => message && message.type === 'after-rollback-cas');
  assert.equal(rollback.replacement, 0);
  assert.equal(Atomics.load(cells, 7), 0);
  assert.equal(Atomics.load(cells, 8), 0);

  const lease = await mutex.acquireAsync();
  assert.equal(Atomics.load(cells, 7), 1);
  await owner.worker.terminate();
  await owner.exit;
  assert.equal(Atomics.load(cells, 7), 1);
  lease.release();
  assert.equal(Atomics.load(cells, 7), 0);
  detach();
});

test('terminate clears every recursive blocking depth and wakes a waiter', { timeout: DEFAULT_TIMEOUT }, async () => {
  const buffer = WorkerMutex.createSharedBuffer({ mode: 'BLOCKING' });
  const cells = new Int32Array(buffer);
  const owner = spawnWorker('scenario.worker.js', {
    libPath: LIB_PATH,
    mode: 'BLOCKING',
    recursionDepth: 5,
    scenario: 'hold',
  });
  const ownerDetach = await startTrackedWorker(owner, buffer);
  await owner.next((message) => message && message.type === 'owned');
  assert.equal(Atomics.load(cells, 8), 5);

  const waiter = spawnWorker('scenario.worker.js', {
    libPath: LIB_PATH,
    mode: 'BLOCKING',
    observeWait: true,
    scenario: 'wait-once',
  });
  const waiterDetach = await startTrackedWorker(waiter, buffer);
  await waiter.next((message) => message && message.type === 'wait-called');
  await owner.worker.terminate();
  await owner.exit;
  await waiter.next((message) => message && message.type === 'acquired');
  await assertWorkerExit(waiter, 0);
  assert.equal(Atomics.load(cells, 7), 0);
  assert.equal(Atomics.load(cells, 8), 0);
  ownerDetach();
  waiterDetach();
});

test('many blocking and native-async worker waiters progress without owner-death rejection', { timeout: DEFAULT_TIMEOUT }, async (t) => {
  for (const mode of ['BLOCKING', 'ASYNC']) {
    if (mode === 'ASYNC' && typeof Atomics.waitAsync !== 'function') {
      t.diagnostic('Native waitAsync unavailable; async worker waiters use fallback in this runtime');
    }

    const buffer = WorkerMutex.createSharedBuffer({ mode });
    const owner = spawnWorker('scenario.worker.js', {
      libPath: LIB_PATH,
      mode,
      scenario: 'hold',
    });
    const ownerDetach = await startTrackedWorker(owner, buffer);
    await owner.next((message) => message && message.type === 'owned');
    const waiters = Array.from({ length: 12 }, () => spawnWorker('scenario.worker.js', {
      libPath: LIB_PATH,
      mode,
      observeWait: mode === 'BLOCKING',
      observeWaitAsync: mode === 'ASYNC' && typeof Atomics.waitAsync === 'function',
      scenario: 'wait-once',
    }));
    const detachers = [];

    for (const waiter of waiters) {
      detachers.push(await startTrackedWorker(waiter, buffer));
    }

    for (const waiter of waiters) {
      await waiter.next((message) => message && (
        message.type === (mode === 'BLOCKING' ? 'wait-called' : 'wait-registered')
        || (mode === 'ASYNC' && typeof Atomics.waitAsync !== 'function' && message.type === 'async-pending')
      ));
    }

    owner.worker.postMessage({ type: 'exit', code: 17 });
    await assertWorkerExit(owner, 17);

    for (const waiter of waiters) {
      await waiter.next((message) => message && message.type === 'acquired');
      await assertWorkerExit(waiter, 0);
    }

    ownerDetach();

    for (const detach of detachers) {
      detach();
    }
  }
});

test('late exit of old owner A cannot mutate ownership already acquired by B', { timeout: DEFAULT_TIMEOUT }, async () => {
  const buffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  const ownerA = spawnWorker('scenario.worker.js', {
    libPath: LIB_PATH,
    mode: 'ASYNC',
    scenario: 'release-and-wait',
  });
  const detachA = await startTrackedWorker(ownerA, buffer);
  await ownerA.next((message) => message && message.type === 'owned');

  const ownerB = spawnWorker('scenario.worker.js', {
    libPath: LIB_PATH,
    mode: 'ASYNC',
    observeWaitAsync: typeof Atomics.waitAsync === 'function',
    scenario: 'hold',
  });
  const detachB = await startTrackedWorker(ownerB, buffer);

  await ownerB.next((message) => message && (
    message.type === 'wait-registered' || message.type === 'async-pending'
  ));

  ownerA.worker.postMessage({ type: 'release' });
  await ownerA.next((message) => message && message.type === 'released');
  await ownerB.next((message) => message && message.type === 'owned');
  ownerA.worker.postMessage({ type: 'exit', code: 0 });
  await assertWorkerExit(ownerA, 0);
  ownerB.worker.postMessage({ type: 'release' });
  await ownerB.next((message) => message && message.type === 'released');
  await assertWorkerExit(ownerB, 0);
  detachA();
  detachB();
});

test('rejects invalid buffer binding without disrupting the worker', { timeout: DEFAULT_TIMEOUT }, async () => {
  const worker = createIdleWorker();
  await worker.next((message) => message === 'ready');
  assert.throws(
    () => WorkerMutex.bindWorkerExit({
      worker: worker.worker,
      sharedBuffer: new SharedArrayBuffer(12)
    }),
    hasCode('MUTEX_BUFFER_LAYOUT_IS_NOT_SUPPORTED')
  );
  worker.worker.postMessage('stop');
  await assertWorkerExit(worker, 0);
});
