'use strict';

const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { after, test } = require('node:test');

const { WorkerMutex } = require('../dist');
const {
  LIB_PATH,
  assertWorkerExit,
  spawnWorker,
  startTrackedWorker,
  terminateLiveWorkers,
  workerPath,
} = require('./helpers');

const DEFAULT_TIMEOUT = 30000;

after(async () => {
  await terminateLiveWorkers();
});

function releaseBarrier(controlBuffer) {
  const control = new Int32Array(controlBuffer);
  Atomics.store(control, 0, 1);
  Atomics.notify(control, 0);
}

async function runMissedWake(mode) {
  const buffer = WorkerMutex.createSharedBuffer({ mode });
  const owner = spawnWorker('scenario.worker.js', {
    libPath: LIB_PATH,
    mode,
    scenario: 'hold',
  });
  const ownerDetach = await startTrackedWorker(owner, buffer);
  await owner.next((message) => message && message.type === 'owned');

  const controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const waiter = spawnWorker('scenario.worker.js', {
    controlBuffer,
    libPath: LIB_PATH,
    mode,
    pauseBeforeWait: mode === 'BLOCKING',
    pauseBeforeWaitAsync: mode === 'ASYNC',
    scenario: 'wait-once',
  });
  const waiterDetach = await startTrackedWorker(waiter, buffer);
  const beforeType = mode === 'BLOCKING' ? 'before-wait' : 'before-wait-async';
  await waiter.next((message) => message && message.type === beforeType);

  owner.worker.postMessage({ type: 'release' });
  await owner.next((message) => message && message.type === 'released');
  releaseBarrier(controlBuffer);

  const waitType = mode === 'BLOCKING' ? 'wait-called' : 'wait-registered';
  await waiter.next((message) => message && message.type === waitType);

  await waiter.next((message) => message && message.type === 'acquired');
  await assertWorkerExit(owner, 0);
  await assertWorkerExit(waiter, 0);
  ownerDetach();
  waiterDetach();
}

async function runDroppedWake(mode) {
  const buffer = WorkerMutex.createSharedBuffer({ mode });
  const owner = spawnWorker('scenario.worker.js', {
    dropWake: true,
    libPath: LIB_PATH,
    mode,
    scenario: 'hold',
  });
  const ownerDetach = await startTrackedWorker(owner, buffer);
  await owner.next((message) => message && message.type === 'owned');

  const waiter = spawnWorker('scenario.worker.js', {
    libPath: LIB_PATH,
    mode,
    observeWait: mode === 'BLOCKING',
    observeWaitAsync: mode === 'ASYNC',
    scenario: 'wait-once',
  });
  const waiterDetach = await startTrackedWorker(waiter, buffer);
  const waitType = mode === 'BLOCKING' ? 'wait-called' : 'wait-registered';
  await waiter.next((message) => message && message.type === waitType);

  owner.worker.postMessage({ type: 'release' });
  const released = await owner.next((message) => message && message.type === 'released');
  assert.equal(released.wakeCalls, 1);
  await waiter.next((message) => message && message.type === 'acquired');
  await assertWorkerExit(owner, 0);
  await assertWorkerExit(waiter, 0);
  ownerDetach();
  waiterDetach();
}

function forkKeeper(mode) {
  const child = fork(workerPath('keepalive.child.js'), [LIB_PATH, mode], {
    silent: true,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exit = once(child, 'exit');

  async function nextMessage() {
    const result = await Promise.race([
      once(child, 'message').then(([message]) => ({ message })),
      exit.then(([code, signal]) => ({ code, signal })),
    ]);

    if (!Object.prototype.hasOwnProperty.call(result, 'message')) {
      throw new Error(
        `KEEPER_CHILD_EXITED_BEFORE_MESSAGE_${result.code}_${result.signal}: ${stderr}`
      );
    }

    return result.message;
  }

  return { child, exit, nextMessage, stderr: () => stderr };
}

test('closes blocking and native-async missed-wake windows without a watchdog tail', { timeout: DEFAULT_TIMEOUT }, async (t) => {
  await runMissedWake('BLOCKING');

  if (typeof Atomics.waitAsync !== 'function') {
    t.diagnostic('Native Atomics.waitAsync is unavailable in this runtime');
    return;
  }

  await runMissedWake('ASYNC');
});

test('makes progress after a dropped blocking or native-async wake through finite watchdogs', { timeout: DEFAULT_TIMEOUT }, async (t) => {
  await runDroppedWake('BLOCKING');

  if (typeof Atomics.waitAsync !== 'function') {
    t.diagnostic('Native Atomics.waitAsync is unavailable in this runtime');
    return;
  }

  await runDroppedWake('ASYNC');
});

test('selects Atomics.wake when Atomics.notify is unavailable', { timeout: DEFAULT_TIMEOUT }, async () => {
  const buffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  const worker = spawnWorker('scenario.worker.js', {
    installWakeOnly: true,
    libPath: LIB_PATH,
    mode: 'ASYNC',
    scenario: 'hold',
  });
  const detach = await startTrackedWorker(worker, buffer);
  await worker.next((message) => message && message.type === 'owned');
  worker.worker.postMessage({ type: 'release' });
  const released = await worker.next((message) => message && message.type === 'released');
  assert.equal(released.wakeCalls, 1);
  await assertWorkerExit(worker, 0);
  detach();
});

test('makes progress for simultaneous fallback acquisitions on many mutexes', { timeout: DEFAULT_TIMEOUT }, async () => {
  const buffers = Array.from({ length: 32 }, () => (
    WorkerMutex.createSharedBuffer({ mode: 'ASYNC' })
  ));
  const holders = [];

  for (const buffer of buffers) {
    holders.push(await new WorkerMutex(buffer).acquireAsync());
  }

  const waiter = spawnWorker('fallback-scheduler.worker.js', { libPath: LIB_PATH });
  await waiter.next((message) => message && message.type === 'ready');
  const detachers = buffers.map((buffer) => (
    WorkerMutex.bindWorkerExit({ worker: waiter.worker, sharedBuffer: buffer })
  ));
  waiter.worker.postMessage({ type: 'start', mutexBuffers: buffers });
  await waiter.next((message) => message && message.type === 'pending');

  for (const holder of holders) {
    holder.release();
  }

  await waiter.next((message) => message && message.type === 'settled');
  await assertWorkerExit(waiter, 0);

  for (const detach of detachers) {
    detach();
  }
});

test('uses monotonic fallback deadlines when wall time moves backward', { timeout: 5000 }, async () => {
  const buffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
  const holder = await new WorkerMutex(buffer).acquireAsync();
  const waiter = spawnWorker('fallback-scheduler.worker.js', {
    libPath: LIB_PATH,
    rewindClock: true,
  });
  await waiter.next((message) => message && message.type === 'ready');
  const detach = WorkerMutex.bindWorkerExit({ worker: waiter.worker, sharedBuffer: buffer });
  waiter.worker.postMessage({ type: 'start', mutexBuffers: [buffer] });
  await waiter.next((message) => message && message.type === 'pending');
  await waiter.next((message) => message && message.type === 'clock-rewound');
  holder.release();
  await waiter.next((message) => message && message.type === 'settled');
  await assertWorkerExit(waiter, 0);
  detach();
});

test('keeps the process alive while acquisitions are pending and lets it exit after settlement', { timeout: DEFAULT_TIMEOUT }, async (t) => {
  const pending = forkKeeper('pending');
  t.after(() => {
    pending.child.kill();
  });
  const pendingResult = await pending.nextMessage();
  assert.equal(pendingResult.phase, 'pending');

  const aliveMessage = pending.nextMessage();
  await new Promise((resolve) => setImmediate(resolve));
  pending.child.send({ type: 'probe' });
  const alive = await aliveMessage;
  assert.equal(alive.phase, 'alive');
  pending.child.kill();
  await pending.exit;

  const settled = forkKeeper('settle');
  t.after(() => {
    settled.child.kill();
  });
  const settledResult = await settled.nextMessage();
  assert.equal(settledResult.phase, 'settled');
  const [code, signal] = await settled.exit;
  assert.equal(code, 0, settled.stderr());
  assert.equal(signal, null);
});
