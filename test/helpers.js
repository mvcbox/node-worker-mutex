'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const LIB_PATH = path.join(PROJECT_ROOT, 'dist');
const liveWorkers = new Set();

function workerPath(name) {
  return path.join(__dirname, 'workers', name);
}

function observeWorker(worker) {
  liveWorkers.add(worker);
  const messages = [];
  const waiters = [];
  let exitResult = null;

  worker.on('message', (message) => {
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));

    if (waiterIndex === -1) {
      messages.push(message);
      return;
    }

    const waiter = waiters.splice(waiterIndex, 1)[0];
    waiter.resolve(message);
  });

  let workerError = null;
  worker.on('error', (error) => {
    workerError = error;
  });

  const exit = new Promise((resolve) => {
    const onExit = (code) => {
      if (worker.threadId !== -1) {
        return;
      }

      worker.removeListener('exit', onExit);
      liveWorkers.delete(worker);
      exitResult = { code, error: workerError };

      while (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter.reject(workerError || new Error(`WORKER_EXITED_WITH_CODE_${code}`));
      }

      resolve(exitResult);
    };
    worker.on('exit', onExit);
  });

  function next(predicate) {
    const matcher = predicate || (() => true);
    const messageIndex = messages.findIndex(matcher);

    if (messageIndex !== -1) {
      return Promise.resolve(messages.splice(messageIndex, 1)[0]);
    }

    if (exitResult !== null) {
      return Promise.reject(
        exitResult.error || new Error(`WORKER_EXITED_WITH_CODE_${exitResult.code}`)
      );
    }

    return new Promise((resolve, reject) => {
      waiters.push({ predicate: matcher, resolve, reject });
    });
  }

  return { worker, exit, next };
}

async function terminateLiveWorkers() {
  const terminations = [];

  for (const worker of liveWorkers) {
    terminations.push(worker.terminate());
  }

  await Promise.all(terminations);
}

function spawnWorker(name, workerData) {
  if (Object.prototype.hasOwnProperty.call(workerData, 'mutexBuffer')) {
    throw new Error('MUTEX_BUFFER_MUST_BE_SENT_AFTER_EXIT_BINDING');
  }

  const worker = new Worker(workerPath(name), { workerData });
  return observeWorker(worker);
}

async function startTrackedWorker(observed, mutexBuffer) {
  const { WorkerMutex } = require(LIB_PATH);
  await observed.next((message) => message && message.type === 'ready');
  const detach = WorkerMutex.bindWorkerExit({ worker: observed.worker, sharedBuffer: mutexBuffer });
  observed.worker.postMessage({ type: 'start', mutexBuffer });
  return detach;
}

async function assertWorkerExit(observed, expectedCode) {
  const result = await observed.exit;

  if (result.error) {
    throw result.error;
  }

  if (result.code !== expectedCode) {
    throw new Error(`WORKER_EXITED_WITH_CODE_${result.code}`);
  }
}

module.exports = {
  LIB_PATH,
  assertWorkerExit,
  observeWorker,
  spawnWorker,
  startTrackedWorker,
  terminateLiveWorkers,
  workerPath,
};
