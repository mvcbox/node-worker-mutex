'use strict';

const { parentPort, workerData } = require('worker_threads');
const { WorkerMutex } = require(workerData.libPath);

(async () => {
  const mutex = new WorkerMutex({ sharedBuffer: workerData.mutexBuffer });
  const counter = new Int32Array(workerData.counterBuffer);
  const iterations = workerData.iterations | 0;

  if (workerData.useAsync) {
    for (let index = 0; index < iterations; index += 1) {
      await mutex.lockAsync();

      try {
        counter[0] += 1;
      } finally {
        mutex.unlock();
      }
    }
  } else {
    for (let index = 0; index < iterations; index += 1) {
      mutex.lock();

      try {
        counter[0] += 1;
      } finally {
        mutex.unlock();
      }
    }
  }

  parentPort.postMessage({ ok: true });
})().catch((error) => {
  parentPort.postMessage({
    ok: false,
    error: error && error.stack ? error.stack : String(error),
  });
});
