[![npm version](https://badge.fury.io/js/worker-mutex.svg)](https://badge.fury.io/js/worker-mutex)

# Worker Mutex
Re-entrant mutex for Node.js `worker_threads` based on `SharedArrayBuffer` + `Atomics`.

- Works across workers and the main thread.
- Supports recursive lock by the same thread.
- Supports blocking (`lock`) and non-blocking (`lockAsync`) modes.
- Can store multiple mutex instances in one shared buffer.

---
## Installation
```bash
npm install worker-mutex
```

---
## Quick start
```ts
import { WorkerMutex } from 'worker-mutex';

const shared = WorkerMutex.createSharedBuffer();
const mutex = new WorkerMutex({ handle: shared });

mutex.lock();
try {
  mutex.lock(); // re-entrant lock (same thread)
  try {
    // critical section
  } finally {
    mutex.unlock();
  }
} finally {
  mutex.unlock();
}
```

---
## Quick start with `worker_threads`
```ts
// main.ts (transpile with "module": "CommonJS")
import * as path from 'path';
import { Worker } from 'worker_threads';
import { WorkerMutex } from 'worker-mutex';

const mutexBuffer = WorkerMutex.createSharedBuffer(1);
const counterBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
const counter = new Int32Array(counterBuffer);

function runWorker() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'worker.js'), {
      workerData: { mutexBuffer, counterBuffer },
    });

    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker exited with code ${code}`));
        return;
      }

      resolve();
    });
  });
}

Promise.all(Array.from({ length: 4 }, () => runWorker()))
  .then(() => {
    console.log(counter[0]); // expected: 40000
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
```

```ts
// worker.ts (runtime file is worker.js after transpile)
import { workerData } from 'worker_threads';
import { WorkerMutex } from 'worker-mutex';

const mutex = new WorkerMutex({ handle: workerData.mutexBuffer, index: 0 });
const counter = new Int32Array(workerData.counterBuffer);

for (let i = 0; i < 10_000; i += 1) {
  mutex.lock();
  try {
    counter[0] += 1;
  } finally {
    mutex.unlock();
  }
}
```

---
## Memory layout
Each mutex occupies 3 `Int32` slots in the shared buffer:

1. `flag` (`0` = unlocked, `1` = locked)
2. `owner` (`threadId` of the owning thread; meaningful only when `flag = 1`)
3. `recursionCount` (current re-entrant depth)

`createSharedBuffer(count)` allocates `count * 3 * Int32Array.BYTES_PER_ELEMENT` bytes.

---
## Multiple mutexes in one buffer
```ts
import { WorkerMutex } from 'worker-mutex';

const shared = WorkerMutex.createSharedBuffer(3);
const mutexA = new WorkerMutex({ handle: shared, index: 0 });
const mutexB = new WorkerMutex({ handle: shared, index: 1 });
const mutexC = new WorkerMutex({ handle: shared, index: 2 });
```

---
## API reference
### `WorkerMutex.createSharedBuffer(count?: number): SharedArrayBuffer`
Creates a shared buffer for one or more mutexes.

- `count` must be a positive safe integer.
- Default: `1`.

### `new WorkerMutex(options)`
Creates a mutex view over an existing shared buffer.

```ts
type WorkerMutexOptions = {
  handle: SharedArrayBuffer;
  index?: number; // default: 0
};
```

### `mutex.lock(): void`
Blocking lock.

- If mutex is free, acquires it.
- If current thread already owns it, increases recursion depth.
- Otherwise waits using `Atomics.wait`.

### `mutex.lockAsync(): Promise<void>`
Non-blocking lock for async flows.

- Uses `Atomics.waitAsync` when available.
- Falls back to soft backoff with `setTimeout` when `waitAsync` is not available.

### `mutex.unlock(): void`
Unlocks one recursion level.

- Throws if current thread is not the owner.
- Fully releases mutex only when recursion depth reaches `0`.

### `mutex.buffer: SharedArrayBuffer`
Returns original `SharedArrayBuffer`.

### `mutex.index: number`
Returns mutex index in the shared buffer.

---
## Errors
All custom errors are instances of `WorkerMutexError`.

Possible error codes:

- `HANDLE_MUST_BE_A_SHARED_ARRAY_BUFFER`
- `HANDLE_BYTE_LENGTH_IS_NOT_INT32_ALIGNED`
- `MUTEX_INDEX_OUT_OF_RANGE`
- `COUNT_MUST_BE_A_POSITIVE_SAFE_INTEGER`
- `COUNT_EXCEEDS_MAX_SUPPORTED_VALUE`
- `MUTEX_IS_NOT_OWNED_BY_CURRENT_THREAD`
- `MUTEX_RECURSION_COUNT_UNDERFLOW`
- `MUTEX_RECURSION_COUNT_OVERFLOW`
- `VALUE_MUST_BE_AN_UNSIGNED_INTEGER`

---
## Notes and limitations
- `lock()` is blocking and can pause the main thread event loop while waiting.
- On the first `lock()` call from the main thread, the library emits a process warning:
  `WORKER_MUTEX_LOCK_ON_MAIN_THREAD_BLOCKS_EVENT_LOOP`.
- Fairness is not guaranteed under heavy contention.
- Always pair `lock/lockAsync` with `unlock` in `try/finally`.

## License

MIT
