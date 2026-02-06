'use strict';

const { parentPort, workerData } = require('worker_threads');
const { WorkerMutex } = require(workerData.libPath);

try {
  const mutex = new WorkerMutex({ sharedBuffer: workerData.mutexBuffer, index: 0 });
  mutex.lock();
  parentPort.postMessage({ state: 'locked' });

  setTimeout(() => {
    try {
      mutex.unlock();
      parentPort.postMessage({ state: 'released' });
    } catch (error) {
      parentPort.postMessage({
        state: 'error',
        error: error && error.stack ? error.stack : String(error),
      });
      process.exitCode = 1;
    }
  }, workerData.holdMs);
} catch (error) {
  parentPort.postMessage({
    state: 'error',
    error: error && error.stack ? error.stack : String(error),
  });
  process.exitCode = 1;
}
