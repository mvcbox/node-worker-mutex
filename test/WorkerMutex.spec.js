'use strict';

const path = require('path');
const { Worker } = require('worker_threads');
const { expect } = require('chai');
const { WorkerMutex, WorkerMutexError } = require('../dist');

const LIB_PATH = path.resolve(__dirname, '..', 'dist');
const COUNTER_WORKER_PATH = path.resolve(__dirname, 'workers', 'counter.worker.js');
const HOLD_LOCK_WORKER_PATH = path.resolve(__dirname, 'workers', 'hold-lock.worker.js');

function runCounterWorker({ mutexBuffer, counterBuffer, iterations, useAsync }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(COUNTER_WORKER_PATH, {
      workerData: {
        libPath: LIB_PATH,
        mutexBuffer,
        counterBuffer,
        iterations,
        useAsync,
      },
    });

    let result;

    worker.once('message', (message) => {
      result = message;
    });

    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (!result) {
        reject(new Error('WORKER_EXITED_WITHOUT_RESULT'));
        return;
      }

      if (result.ok === false) {
        reject(new Error(result.error || 'WORKER_FAILED'));
        return;
      }

      if (code !== 0) {
        reject(new Error(`WORKER_EXITED_WITH_CODE_${code}`));
        return;
      }

      resolve();
    });
  });
}

function waitForMessage(worker) {
  return new Promise((resolve, reject) => {
    const onMessage = (message) => {
      cleanup();
      resolve(message);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`WORKER_EXITED_WITH_CODE_${code}`));
    };
    const cleanup = () => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
  });
}

function waitForExit(worker) {
  return new Promise((resolve, reject) => {
    if (typeof worker.exitCode === 'number') {
      if (worker.exitCode !== 0) {
        reject(new Error(`WORKER_EXITED_WITH_CODE_${worker.exitCode}`));
        return;
      }

      resolve();
      return;
    }

    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`WORKER_EXITED_WITH_CODE_${code}`));
        return;
      }

      resolve();
    });
  });
}

describe('WorkerMutex', function() {
  this.timeout(30000);

  let originalEmitWarning;

  before(() => {
    originalEmitWarning = process.emitWarning;
    process.emitWarning = () => undefined;
  });

  after(() => {
    process.emitWarning = originalEmitWarning;
  });

  it('allocates shared buffer with expected size', () => {
    const count = 4;
    const buffer = WorkerMutex.createSharedBuffer(count);

    expect(buffer).instanceOf(SharedArrayBuffer);
    expect(buffer.byteLength).equal(count * 3 * Int32Array.BYTES_PER_ELEMENT);
  });

  it('validates count for createSharedBuffer', () => {
    expect(() => WorkerMutex.createSharedBuffer(0)).to.throw(
      WorkerMutexError,
      'COUNT_MUST_BE_A_POSITIVE_SAFE_INTEGER'
    );
    expect(() => WorkerMutex.createSharedBuffer(1.2)).to.throw(
      WorkerMutexError,
      'COUNT_MUST_BE_A_POSITIVE_SAFE_INTEGER'
    );
    expect(() => WorkerMutex.createSharedBuffer(Number.MAX_SAFE_INTEGER)).to.throw(
      WorkerMutexError,
      'COUNT_EXCEEDS_MAX_SUPPORTED_VALUE'
    );
  });

  it('validates constructor options', () => {
    expect(() => new WorkerMutex({ handle: new ArrayBuffer(8) })).to.throw(
      WorkerMutexError,
      'HANDLE_MUST_BE_A_SHARED_ARRAY_BUFFER'
    );
    expect(() => new WorkerMutex({ handle: new SharedArrayBuffer(10) })).to.throw(
      WorkerMutexError,
      'HANDLE_BYTE_LENGTH_IS_NOT_INT32_ALIGNED'
    );
    expect(() => new WorkerMutex({ handle: WorkerMutex.createSharedBuffer(1), index: 2 })).to.throw(
      WorkerMutexError,
      'MUTEX_INDEX_OUT_OF_RANGE'
    );
    expect(() => new WorkerMutex({ handle: WorkerMutex.createSharedBuffer(1), index: 1.5 })).to.throw(
      WorkerMutexError,
      'VALUE_MUST_BE_AN_UNSIGNED_INTEGER'
    );
  });

  it('supports recursive lock and full unlock', () => {
    const buffer = WorkerMutex.createSharedBuffer();
    const mutex = new WorkerMutex({ handle: buffer });
    const cells = new Int32Array(buffer);

    mutex.lock();
    mutex.lock();

    expect(cells[0]).equal(1);
    expect(cells[2]).equal(2);

    mutex.unlock();
    expect(cells[0]).equal(1);
    expect(cells[2]).equal(1);

    mutex.unlock();
    expect(cells[0]).equal(0);
    expect(cells[1]).equal(0);
    expect(cells[2]).equal(0);
  });

  it('throws when unlocking from non-owner thread/state', () => {
    const mutex = new WorkerMutex({ handle: WorkerMutex.createSharedBuffer() });

    expect(() => mutex.unlock()).to.throw(
      WorkerMutexError,
      'MUTEX_IS_NOT_OWNED_BY_CURRENT_THREAD'
    );
  });

  it('detects recursion counter underflow', () => {
    const buffer = WorkerMutex.createSharedBuffer();
    const mutex = new WorkerMutex({ handle: buffer });
    const cells = new Int32Array(buffer);

    mutex.lock();
    cells[2] = 0;

    expect(() => mutex.unlock()).to.throw(
      WorkerMutexError,
      'MUTEX_RECURSION_COUNT_UNDERFLOW'
    );
  });

  it('detects recursion counter overflow on re-entrant lock', () => {
    const buffer = WorkerMutex.createSharedBuffer();
    const mutex = new WorkerMutex({ handle: buffer });
    const cells = new Int32Array(buffer);

    mutex.lock();
    cells[2] = 2147483647;

    expect(() => mutex.lock()).to.throw(
      WorkerMutexError,
      'MUTEX_RECURSION_COUNT_OVERFLOW'
    );
  });

  it('supports recursive lockAsync on same thread', async () => {
    const buffer = WorkerMutex.createSharedBuffer();
    const mutex = new WorkerMutex({ handle: buffer });
    const cells = new Int32Array(buffer);

    await mutex.lockAsync();
    await mutex.lockAsync();

    expect(cells[0]).equal(1);
    expect(cells[2]).equal(2);

    mutex.unlock();
    mutex.unlock();

    expect(cells[0]).equal(0);
    expect(cells[2]).equal(0);
  });

  it('waits in lockAsync until another thread releases mutex', async () => {
    const mutexBuffer = WorkerMutex.createSharedBuffer(1);
    const mutex = new WorkerMutex({ handle: mutexBuffer, index: 0 });

    const worker = new Worker(HOLD_LOCK_WORKER_PATH, {
      workerData: {
        libPath: LIB_PATH,
        mutexBuffer,
        holdMs: 60,
      },
    });

    const exitPromise = waitForExit(worker);

    try {
      const state = await waitForMessage(worker);
      expect(state).deep.equal({ state: 'locked' });

      const startedAt = Date.now();
      await mutex.lockAsync();
      const elapsed = Date.now() - startedAt;

      expect(elapsed).at.least(25);

      mutex.unlock();
    } finally {
      await exitPromise;
    }
  });

  it('serializes increments across workers with lock()', async () => {
    const workers = 4;
    const iterations = 1000;
    const mutexBuffer = WorkerMutex.createSharedBuffer(1);
    const counterBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const counter = new Int32Array(counterBuffer);

    await Promise.all(
      Array.from({ length: workers }, () => runCounterWorker({
        mutexBuffer,
        counterBuffer,
        iterations,
        useAsync: false,
      }))
    );

    expect(counter[0]).equal(workers * iterations);
  });

  it('serializes increments across workers with lockAsync()', async () => {
    const workers = 4;
    const iterations = 1000;
    const mutexBuffer = WorkerMutex.createSharedBuffer(1);
    const counterBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const counter = new Int32Array(counterBuffer);

    await Promise.all(
      Array.from({ length: workers }, () => runCounterWorker({
        mutexBuffer,
        counterBuffer,
        iterations,
        useAsync: true,
      }))
    );

    expect(counter[0]).equal(workers * iterations);
  });
});
