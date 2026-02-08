'use strict';

const { parentPort, workerData } = require('worker_threads');
const { WorkerMutex } = require(workerData.libPath);

try {
  const mutex = new WorkerMutex(workerData.mutexBuffer);
  mutex.lock();
  parentPort.postMessage({ state: 'locked' });

  setTimeout(() => {
    process.exit(0);
  }, 0);
} catch (error) {
  parentPort.postMessage({
    state: 'error',
    error: error && error.stack ? error.stack : String(error),
  });
  process.exitCode = 1;
}
