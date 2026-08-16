'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { WorkerMutex } = require(workerData.libPath);

async function run() {
  parentPort.postMessage({ type: 'ready' });
  const start = await new Promise((resolve) => parentPort.once('message', resolve));

  if (!start || start.type !== 'start' || !Array.isArray(start.mutexBuffers)) {
    throw new Error('START_BUFFERS_REQUIRED');
  }

  const leases = [];

  for (const buffer of start.mutexBuffers) {
    leases.push(await new WorkerMutex(buffer).acquireAsync());
  }

  parentPort.postMessage({ type: 'owned', count: leases.length });
  const command = await new Promise((resolve) => parentPort.once('message', resolve));

  if (!command || command.type !== 'exit') {
    throw new Error('EXIT_COMMAND_REQUIRED');
  }

  process.exit(command.code === undefined ? 0 : command.code);
}

run().catch((error) => {
  parentPort.postMessage({
    type: 'error',
    code: error && error.code,
    error: error && error.stack ? error.stack : String(error),
  });
  process.exitCode = 1;
});
