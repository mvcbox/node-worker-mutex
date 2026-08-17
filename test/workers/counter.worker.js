'use strict';

const { parentPort, workerData } = require('worker_threads');
const { WorkerMutex } = require(workerData.libPath);

async function run() {
  const start = await new Promise((resolve) => {
    parentPort.once('message', (message) => {
      if (message && message.type === 'start') {
        resolve(message);
      }
    });
    parentPort.postMessage({ type: 'ready' });
  });

  const mutex = new WorkerMutex(start.mutexBuffer);
  const counter = new Int32Array(workerData.counterBuffer);
  const iterations = workerData.iterations | 0;

  for (let index = 0; index < iterations; index += 1) {
    if (workerData.mode === 'BLOCKING') {
      mutex.lock();

      try {
        counter[0] += 1;
      } finally {
        mutex.unlock();
      }
    } else {
      await mutex.runExclusive(() => {
        counter[0] += 1;
      });
    }
  }

  parentPort.postMessage({ type: 'done' });
}

run().catch((error) => {
  parentPort.postMessage({
    type: 'error',
    code: error && error.code,
    error: error && error.stack ? error.stack : String(error),
  });
  process.exitCode = 1;
});
