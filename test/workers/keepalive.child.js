'use strict';

const path = require('node:path');

const libPath = process.argv[2];
const mode = process.argv[3] || 'pending';

if (process.channel && typeof process.channel.unref === 'function') {
  process.channel.unref();
}

const { WorkerMutex } = require(path.resolve(libPath));

async function createCycle() {
  const held = [];
  const pending = [];

  for (let mutexIndex = 0; mutexIndex < 4; mutexIndex += 1) {
    const mutex = new WorkerMutex(WorkerMutex.createSharedBuffer({ mode: 'ASYNC' }));
    held.push(await mutex.acquireAsync());

    for (let waiterIndex = 0; waiterIndex < 25; waiterIndex += 1) {
      pending.push(mutex.acquireAsync());
    }
  }

  await Promise.resolve();
  return { held, pending };
}

async function settleCycle(cycle) {
  for (const lease of cycle.held) {
    lease.release();
  }

  for (const acquisition of cycle.pending) {
    const lease = await acquisition;
    lease.release();
  }
}

function publish(result) {
  return new Promise((resolve, reject) => {
    process.send(result, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function run() {
  const first = await createCycle();

  if (mode === 'pending') {
    process.on('message', (message) => {
      if (message && message.type === 'probe') {
        publish({ phase: 'alive' }).catch((error) => {
          process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
          process.exitCode = 1;
        });
      }
    });
    await publish({ phase: 'pending' });
    return;
  }

  await settleCycle(first);

  for (let cycleIndex = 1; cycleIndex < 4; cycleIndex += 1) {
    await settleCycle(await createCycle());
  }

  await publish({ phase: 'settled' });
}

run().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
