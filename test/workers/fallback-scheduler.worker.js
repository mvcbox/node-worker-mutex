'use strict';

const { parentPort, workerData } = require('worker_threads');

Atomics.waitAsync = undefined;

if (workerData.rewindClock) {
  const nativeDateNow = Date.now;
  const nativeSetTimeout = global.setTimeout;
  let clockRewound = false;

  Date.now = function rewoundDateNow() {
    return nativeDateNow() - (clockRewound ? 100000 : 0);
  };

  global.setTimeout = function setTimeoutProxy(callback, delay) {
    return nativeSetTimeout(function wrappedTimer() {
      if (!clockRewound && delay < 10000) {
        clockRewound = true;
        parentPort.postMessage({ type: 'clock-rewound' });
      }

      callback();
    }, delay);
  };
}

const { WorkerMutex } = require(workerData.libPath);

async function run() {
  parentPort.postMessage({ type: 'ready' });
  const start = await new Promise((resolve) => parentPort.once('message', resolve));

  if (!start || start.type !== 'start' || !Array.isArray(start.mutexBuffers)) {
    throw new Error('START_BUFFERS_REQUIRED');
  }

  const pending = start.mutexBuffers.map((buffer) => (
    new WorkerMutex(buffer).acquireAsync()
  ));
  await Promise.resolve();
  parentPort.postMessage({ type: 'pending' });
  const leases = await Promise.all(pending);

  for (const lease of leases) {
    lease.release();
  }

  parentPort.postMessage({ type: 'settled' });
}

run().catch((error) => {
  parentPort.postMessage({
    type: 'error',
    code: error && error.code,
    error: error && error.stack ? error.stack : String(error)
  });
  process.exitCode = 1;
});
