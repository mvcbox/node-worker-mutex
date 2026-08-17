[![npm version](https://badge.fury.io/js/worker-mutex.svg)](https://badge.fury.io/js/worker-mutex)

# Worker Mutex

`worker-mutex` provides mutual exclusion for Node.js `worker_threads`, built on
`SharedArrayBuffer` and `Atomics`.

- Supports Node.js `>=10.5.0` through runtime capability detection.
- Uses an explicit blocking or async mode for each mutex.
- Can automatically release mutex ownership abandoned by a directly bound
  worker that genuinely exits.
- Uses a versioned, opaque shared-memory layout.

Automatic abandoned-state cleanup is a mutex liveness feature, not a
transaction or data-recovery mechanism. It resets only mutex metadata. The next
owner proceeds normally and may observe application data left partially
updated by the exited worker.

## Installation

```bash
npm install worker-mutex
```

All Node.js 10.x releases and Node.js 11.0–11.6 require the
`--experimental-worker` flag:

```bash
node --experimental-worker app.js
```

Node.js 10 is supported for functional compatibility only. It is end-of-life
and receives no security fixes. A currently maintained Node.js LTS release is
strongly recommended for production.

TypeScript consumers require TypeScript `>=5.6`. The package installs
`@types/node` because the `worker` parameter of `bindWorkerExit()` is a
`worker_threads.Worker`. These declarations are not loaded by the runtime, so
they do not change the Node.js `>=10.5.0` runtime floor.

The public lease type uses the explicit resource management protocol. Add
`ESNext.Disposable` to the consumer compiler libraries:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["ES2017", "ES2017.SharedMemory", "ESNext.Disposable"]
  }
}
```

## Choose a mutex mode

The mode is required when the shared buffer is created, is encoded in the
buffer, and cannot be changed later.

Plain JavaScript may use the raw string values:

```js
const { WorkerMutex } = require('worker-mutex');

const blockingBuffer = WorkerMutex.createSharedBuffer({ mode: 'BLOCKING' });
const asyncBuffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
```

TypeScript uses the exported runtime enum:

```ts
import { WorkerMutex, WorkerMutexModeEnum } from 'worker-mutex';

const blockingOptions = {
  mode: WorkerMutexModeEnum.BLOCKING
};
const asyncOptions = {
  mode: WorkerMutexModeEnum.ASYNC
};

const blockingBuffer = WorkerMutex.createSharedBuffer(blockingOptions);
const asyncBuffer = WorkerMutex.createSharedBuffer(asyncOptions);
```

The `createSharedBuffer()` input requires `mode` and treats it as readonly.
Raw JavaScript values are case-sensitive. Lowercase `'blocking'` and `'async'`
are invalid and throw `MUTEX_MODE_MUST_BE_BLOCKING_OR_ASYNC`.

| Mode | Plain JavaScript value | API | Supported isolates |
| --- | --- | --- | --- |
| `WorkerMutexModeEnum.BLOCKING` | `'BLOCKING'` | `lock()` / `unlock()` | Worker threads |
| `WorkerMutexModeEnum.ASYNC` | `'ASYNC'` | `acquireAsync()` / lease, `runExclusive()` | Main thread or worker threads |

The two APIs cannot be mixed on one mutex. A blocking method on an async mutex
throws a `WorkerMutexError` synchronously. `acquireAsync()` or `runExclusive()`
on a blocking mutex returns a rejected Promise with `WorkerMutexError`.
Separate blocking and async mutexes can coexist.

This separation applies to every supported Node.js version. A blocking waiter
can reacquire before a Promise continuation runs, so mixing the scheduling
models cannot provide a reliable starvation guarantee. Older Node.js polling
makes the imbalance more visible, but does not cause it.

Strict FIFO ordering between workers is not guaranteed. Mutual exclusion and
wake-up progress assume cooperative code that follows the ownership, binding,
and process-lifetime contracts documented below.

## Async mode

`runExclusive()` is the preferred async API. It acquires a lease, passes it to
the callback, and releases it in `finally` if the callback has not already
released it.

```js
const { WorkerMutex } = require('worker-mutex');

const sharedBuffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
const mutex = new WorkerMutex(sharedBuffer);

async function updateRelatedRecords(lease) {
  // Pass the active lease through nested code instead of acquiring again.
  if (lease.released) {
    throw new Error('Expected an active mutex lease');
  }

  // Protected async work may run here without another acquisition.
}

async function updateRecords() {
  await mutex.runExclusive(async function (lease) {
    await updateRelatedRecords(lease);
    // Mutate the protected state here.
  });
}
```

TypeScript can bind the lease lifetime directly to a lexical scope:

```ts
async function updateWithUsing(mutex: WorkerMutex) {
  using lease = await mutex.acquireAsync();
  // Await all protected work before leaving this scope.
}
```

`using` performs deterministic cleanup on normal and exceptional scope exits.
It is not garbage-collection finalization: losing the lease reference does not
release the mutex, and a worker or process crash does not execute scope cleanup.
Node.js 10 cannot parse raw `using` syntax, so TypeScript must compile it to the
configured ES2017 target before execution.

Use `acquireAsync()` with `try`/`finally` when manual lifetime control or plain
JavaScript compatibility is necessary:

```js
async function updateManually(mutex) {
  const lease = await mutex.acquireAsync();

  try {
    // Mutate the protected state here.
  } finally {
    if (!lease.released) {
      lease.release();
    }
  }
}
```

`WorkerMutexLease` is a cooperative, isolate-local ownership handle. Its
constructor is private in the TypeScript declarations, and direct construction
from JavaScript is runtime-guarded with
`MUTEX_LEASE_CONSTRUCTION_NOT_ALLOWED`. Do not send a lease through structured
clone or treat it as authority in another worker.

`release()` is deliberately not idempotent. Releasing an already released or
stale lease throws `MUTEX_LEASE_IS_NOT_ACTIVE`. The readonly `released`
property can be inspected when cleanup code may receive an already released
lease.

`lease[Symbol.dispose]()` releases an active lease and does nothing after a
successful earlier release or disposal. If the underlying release throws, the
lease remains active and a later explicit disposal or `release()` retries the
operation. A `using` scope itself performs only one automatic disposal attempt.

Async ownership is not implicitly re-entrant. Two independent Promise flows in
the same isolate are separate contenders even though they have the same
`worker_threads.threadId`. Nested code must receive the existing lease
explicitly and must not call `acquireAsync()` again while that lease remains
active.

If a `runExclusive()` callback releases its lease early, the remainder of the
callback is no longer protected. Normally, let `runExclusive()` release it
after the callback settles.

### Async scheduling and process lifetime

While at least one local async acquisition is pending, the library intentionally
keeps the Node.js process alive with one shared referenced keeper per isolate.
Pending waiters do not each create a long-lived referenced timer.

Finite wake rechecks share one isolate-global unreferenced scheduler.
On runtimes without a working `Atomics.waitAsync`, the same scheduler also
coalesces polling. This avoids a timer per waiter, but old runtimes have higher
contention latency and polling CPU cost than the modern fast path.

The fallback deliberately varies polling phases between mutexes and isolates
instead of maximizing timer coalescing. In a stress measurement with 10,000
distinct contended mutexes in one isolate, this produced about 2.3 times as
many timer callbacks and about 25% more scheduler CPU than a static-jitter
reference, without a material elapsed-time difference. These figures
characterize that workload rather than promise a fixed bound. Applications
with similarly high-cardinality contention should prefer a runtime with a
working `Atomics.waitAsync` path.

For `M` distinct mutexes with pending waiters in one isolate, watchdog tracking
uses `O(M)` scheduler records and `O(log M)` heap operations while retaining one
shared unreferenced scheduler timer. This timer is separate from the single
referenced keeper that keeps the process alive while acquisitions are pending.

Unlock and abandoned-owner cleanup wake every current waiter. This
liveness-biased policy avoids depending on one selected waiter surviving and
running promptly, but heavy contention can create a thundering herd of retries.
Strict FIFO ordering and starvation freedom between isolates are not promised.

## Blocking mode

`lock()` blocks the current JavaScript isolate. It is allowed in worker
threads and is rejected on the main thread with
`MUTEX_BLOCKING_LOCK_NOT_ALLOWED`.

```js
const { WorkerMutex } = require('worker-mutex');
const { workerData } = require('worker_threads');

const mutex = new WorkerMutex(workerData.mutexBuffer);

mutex.lock();
try {
  mutex.lock();
  try {
    // Recursive blocking acquisition by the same worker is supported.
  } finally {
    mutex.unlock();
  }
} finally {
  mutex.unlock();
}
```

Every successful recursive `lock()` requires one matching `unlock()`. A
worker that exits without completing those calls can be handled only when the
main thread established `bindWorkerExit()` before that worker received the
buffer.

## Automatic abandoned mutex-state cleanup

`WorkerMutex.bindWorkerExit({ worker, sharedBuffer })` registers one mutex buffer
for cleanup when a genuine Node.js Worker exit occurs.

The supported topology is deliberately narrow:

- `bindWorkerExit()` may be called only on the main thread;
- `worker` must be a real, live `worker_threads.Worker` directly owned by
  that main thread;
- the binding must succeed before the worker receives the mutex buffer or can
  otherwise acquire it.

Calling `bindWorkerExit()` inside a worker throws
`WORKER_EXIT_BINDING_REQUIRES_MAIN_THREAD`. Therefore automatic cleanup for a
nested worker created by another worker is unsupported. Restructure that
topology so the main thread directly creates and binds every possible mutex
owner, or do not rely on automatic abandoned-state cleanup.

### Start barrier

Do **not** put a mutex buffer that relies on automatic cleanup in
`workerData`. The worker could acquire it before the main thread installs the
exit binding. Create the worker without the mutex buffer, bind first, and only
then send the buffer with `postMessage()`.

Install the library binding before user `'exit'` listeners. Node.js
`Worker` uses cooperative `EventEmitter` listener ordering; an earlier user
listener that throws can prevent a later cleanup listener from running.

```js
// main.js
const path = require('path');
const { Worker } = require('worker_threads');
const { WorkerMutex } = require('worker-mutex');

const mutexBuffer = WorkerMutex.createSharedBuffer({ mode: 'BLOCKING' });
const counterBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
const counter = new Int32Array(counterBuffer);

function runWorker() {
  return new Promise(function (resolve, reject) {
    const worker = new Worker(path.join(__dirname, 'worker.js'), {
      workerData: { counterBuffer: counterBuffer }
    });

    worker.once('error', reject);

    // Bind before adding user exit listeners or sharing mutexBuffer.
    WorkerMutex.bindWorkerExit({ worker, sharedBuffer: mutexBuffer });

    worker.once('exit', function (code) {
      if (code !== 0) {
        reject(new Error('Worker exited with code ' + code));
        return;
      }

      resolve();
    });

    worker.postMessage({ type: 'start', mutexBuffer: mutexBuffer });
  });
}

Promise.all([runWorker(), runWorker(), runWorker(), runWorker()])
  .then(function () {
    console.log(counter[0]); // Expected: 40000
  })
  .catch(function (error) {
    console.error(error);
    process.exitCode = 1;
  });
```

```js
// worker.js
const { parentPort, workerData } = require('worker_threads');
const { WorkerMutex } = require('worker-mutex');

const counter = new Int32Array(workerData.counterBuffer);

parentPort.once('message', function (message) {
  if (!message || message.type !== 'start') {
    throw new Error('Expected a start message');
  }

  const mutex = new WorkerMutex(message.mutexBuffer);

  for (let index = 0; index < 10000; index += 1) {
    mutex.lock();
    try {
      counter[0] += 1;
    } finally {
      mutex.unlock();
    }
  }
});
```

### What cleanup does

After the bound Worker genuinely exits, the library checks each registered
mutex. If that worker is still the owner, cleanup:

1. resets only the mutex owner and recursion depth to the free state;
2. advances the mutex wake generation;
3. wakes waiting workers and async acquisitions.

There is no special status or error for the next owner. It acquires normally.
The cleanup does not inspect, roll back, validate, or repair any user data
protected by the mutex. If a worker can exit midway through an update, design
that update to be transactional, journaled, idempotent, or independently
validated before the next owner uses the data.

### Binding and disposer constraints

The returned disposer is idempotent, but it removes the cleanup guarantee. Call
it while a worker is still alive only after an application-level handshake
proves that the worker has released the mutex and can never acquire it again.
Normal worker exit automatically removes its registrations, so manual disposal
is not required afterward.

Repeated bindings for one Worker share library exit tracking. The binding
depends on cooperative EventEmitter behavior:

- do not remove, replace, or reorder the library's `'exit'` listener;
- do not call `removeAllListeners('exit')` on a bound Worker;
- do not monkey-patch Worker EventEmitter methods;
- add normal user `'exit'` listeners only after binding and keep them from
  interfering with library listeners.

A fake Worker-like object is rejected. Manually emitting a synthetic
`'exit'` event on a still-live real Worker does not trigger cleanup. Only the
genuine exit of the bound Worker is authoritative.

Cleanup also requires the main process and its event loop to remain alive until
that genuine exit is handled. `worker.unref()` followed by natural early main
process exit, a main-process crash, `SIGKILL`, or machine failure removes this
guarantee.

## API reference

### `WorkerMutex.createSharedBuffer(input: { readonly mode: WorkerMutexModeEnum }): SharedArrayBuffer`

Creates a versioned shared buffer for one mutex. In TypeScript, `input.mode`
is `WorkerMutexModeEnum`; use `WorkerMutexModeEnum.BLOCKING` or
`WorkerMutexModeEnum.ASYNC`. Plain JavaScript may pass the corresponding raw
strings `'BLOCKING'` or `'ASYNC'`. Secure random bytes are required here to
create the mutex identity. These raw strings are case-sensitive; lowercase
values throw `MUTEX_MODE_MUST_BE_BLOCKING_OR_ASYNC`. Treat the returned buffer
as opaque.

### `new WorkerMutex(sharedBuffer: SharedArrayBuffer)`

Creates a local mutex view over an existing compatible shared buffer. It
validates the buffer type, fixed size, layout version, mutex identifier, and
runtime capabilities before use. Attaching to an existing buffer does not
require cryptographic randomness.

### `WorkerMutex.bindWorkerExit(input: { readonly worker: Worker; readonly sharedBuffer: SharedArrayBuffer }): () => void`

Main-thread-only registration for automatic abandoned mutex-state cleanup. The
`input.worker` value is an actual live `worker_threads.Worker`, not a structural
EventEmitter substitute. `input.sharedBuffer` identifies the tracked mutex.
Returns an idempotent disposer.

### `mutex.mode: WorkerMutexModeEnum` (readonly)

Returns `WorkerMutexModeEnum.BLOCKING` or `WorkerMutexModeEnum.ASYNC`. Because
this is a string enum, the runtime values are still `'BLOCKING'` and `'ASYNC'`.

### `mutex.sharedBuffer: SharedArrayBuffer` (readonly)

Returns the original shared buffer.

### `mutex.lock(): void`

Acquires a blocking mutex in a worker thread. Recursive acquisition by the same
worker increments its recursion depth.

### `mutex.unlock(): void`

Releases one blocking recursion level. The mutex becomes free after the final
matching `unlock()`.

### `mutex.acquireAsync(): Promise<WorkerMutexLease>`

Acquires an async mutex and resolves with its unique active lease.

### `lease.released: boolean` (readonly)

Reports whether the lease is no longer active.

### `lease.release(): void`

Releases an async mutex. A repeated, stale, or otherwise invalid release throws
`MUTEX_LEASE_IS_NOT_ACTIVE`.

### `lease[Symbol.dispose](): void`

Releases an active async mutex lease for TypeScript `using` and the standard
explicit resource management protocol. Disposal after a successful release is
a no-op; direct repeated `release()` remains an error.

### `mutex.runExclusive<T>(callback: (lease: WorkerMutexLease) => T | PromiseLike<T>): Promise<T>`

Acquires an async lease, calls `callback(lease)`, and returns the callback
result. It releases the lease in `finally` only if the callback has not already
released it.

### Public exports

The package exports `WorkerMutex`, the nonconstructible-at-runtime
`WorkerMutexLease` class, `WorkerMutexError`, and the runtime string enums
`WorkerMutexModeEnum` and `WorkerMutexErrorCodeEnum`. Method DTO declarations
are internal package details and are not exported. Prefer inference or
`Parameters<typeof WorkerMutex.createSharedBuffer>[0]` when an explicit reusable
input type is needed; deep imports are unsupported.

`WorkerMutexModeEnum` is available as a runtime object because the build
preserves the source `const enum`. The published TypeScript declaration is
intentionally rewritten as a regular enum for `isolatedModules` compatibility;
the source representation is an implementation detail. This packaging does
not change the Node.js runtime floor.

## Runtime compatibility and trade-offs

The package keeps the declared `node >=10.5.0` range. It does not select an
implementation from `process.version`; it detects actual capabilities so
vendor builds and backports use the safest available path.

| Node.js runtime | Worker status and startup | Wait/wake path | Trade-offs |
| --- | --- | --- | --- |
| 10.5.x | Experimental; requires `--experimental-worker` | `Atomics.wake` and coalesced polling | CommonJS/ES2017; highest contention latency and polling cost; EOL |
| 10.6.x | Experimental; requires `--experimental-worker` | Feature-detected `Atomics.notify` or `Atomics.wake` and coalesced polling | CommonJS/ES2017; higher contention latency and polling cost; EOL |
| 11.0–11.6 | Experimental; requires `--experimental-worker` | Feature-detected notify/wake and coalesced polling | CommonJS/ES2017; higher contention latency and polling cost; EOL |
| 11.7–12.10 | CLI flag removed; Worker API still experimental | Feature-detected notify/wake and coalesced polling | CommonJS/ES2017; higher contention latency and polling cost; EOL |
| 12.11–15 | Worker API stable | Feature-detected notify/wake and coalesced polling | CommonJS/ES2017; higher contention latency and polling cost; EOL |
| >=16 | Worker API stable | Feature-detected `Atomics.waitAsync` fast path, with safe scheduled rechecks | Lowest latency and polling cost when the fast path is usable; modern ESM interop |

Every supported path uses the same Int32 atomic state protocol, abandoned-state
cleanup, ownership checks, and finite wake rechecks. BigInt Atomics are not
required. Runtime age affects latency, CPU use, startup flags, and process
lifecycle—not mutual-exclusion correctness.

The runtime verifies the facilities required for an operation, including
`worker_threads`, `SharedArrayBuffer`, Int32 `Atomics`, notify-or-wake,
`setTimeout`, `clearTimeout`, a valid `process.hrtime()`, and the isolate-local
registry contract. These base timer and monotonic-clock capabilities are
required for both mutex modes. Async use additionally validates timer-handle
operations lazily when it first needs the keeper or scheduler. Missing or
incompatible required capabilities fail fast with a `WorkerMutexError`; the
library does not silently select an unsafe mode. `Atomics.waitAsync` is an
optional optimization, so its absence selects the coalesced scheduler instead
of failing.

Cryptographic randomness is checked only by `createSharedBuffer()`.
Constructing a mutex over an already valid buffer does not require
`crypto.randomBytes()`.

At package load, the library verifies the isolate's `Symbol.dispose`. On legacy
runtimes where it is entirely absent, the library installs only this symbol as
a non-writable, non-enumerable, non-configurable property. A compatible mutable
own data-symbol keeps its identity but is hardened to the same descriptor. The
library leaves an already hardened valid own data-symbol completely unchanged,
including its identity and descriptor. The library does not install
`DisposableStack`, `AsyncDisposableStack`,
`Symbol.asyncDispose`, or `SuppressedError`. Inherited, accessor, non-symbol,
or safely unhardenable definitions fail during package loading with
`SYMBOL_DISPOSE_IS_NOT_AVAILABLE` instead of being replaced.

### Node.js 10 termination and process-lifetime warning

The experimental Node.js 10 Worker documentation warns that terminating a
worker at an arbitrary point could crash Node.js when the worker was using core
modules beyond the worker API. Apply `worker.terminate()` cautiously on this
compatibility path.

Automatic abandoned-state cleanup is delivered by the main thread's genuine
Worker `'exit'` event. It cannot run after the main process exits. In
particular, combining `worker.unref()` with a naturally terminating main event
loop can end the process before cleanup is observed.

### Modern ESM interop

The universal implementation is CommonJS/ES2017 so it can load on Node.js 10.5.
Modern ESM applications import the same implementation:

```js
import { WorkerMutex } from 'worker-mutex';

const buffer = WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });
const mutex = new WorkerMutex(buffer);
```

Do not rely on native ESM on the Node.js 10 compatibility path.

## Migrating from 1.x to 2.x

Version 2 is a coordinated restart upgrade. Its buffer and public acquisition
contracts are intentionally incompatible with 1.x.

| Area | 1.x | 2.x | Required change |
| --- | --- | --- | --- |
| Shared buffer | Unversioned 12-byte, three-`Int32` layout | Versioned opaque layout | Stop all workers and create a new buffer; never reuse a 1.x buffer |
| Creation input | Empty, unused `WorkerMutexOptions` | Required structural input `{ readonly mode: WorkerMutexModeEnum }` | Remove the old type import and pass an object with an enum member |
| Mode | One buffer accepted blocking and async calls | Required immutable `WorkerMutexModeEnum.BLOCKING` or `WorkerMutexModeEnum.ASYNC` mode; plain JavaScript retains raw strings | TypeScript imports the enum; JavaScript chooses `'BLOCKING'` or `'ASYNC'` in every `createSharedBuffer({ mode })` call |
| Async ownership | `lockAsync(): Promise<void>` paired with `unlock()` | `acquireAsync()` returns a lease; `runExclusive()` is preferred | Replace async call sites and release the returned lease |
| Async recursion | Same-thread calls were treated as recursive | No implicit async recursion | Pass the current lease explicitly through nested code |
| Main-thread blocking | `lock()` was allowed with a warning | `lock()` throws on main | Use an async-mode mutex and `runExclusive()` |
| Exit binding | Could be installed after the buffer was already shared and accepted Worker-like objects | Main-thread-only object input `{ worker, sharedBuffer }`, genuine direct Worker, bind-before-share barrier | Change the call shape, worker startup order, and topology |
| Abandoned owner | Mutex metadata was reset after a tracked exit | Mutex owner/depth are atomically returned to free and waiters wake after a genuine tracked exit | Do not assume application data is valid; there is no repair notification |
| Errors | Callers often compared message strings | Stable readonly `error.code`; `message === code`; exported `WorkerMutexErrorCodeEnum` | Branch on `error.code === WorkerMutexErrorCodeEnum.X`; TypeScript constructor calls use an enum member |
| TypeScript | No explicit compiler floor | TypeScript `>=5.6`, automatically installed Node declarations, and `ESNext.Disposable` | Upgrade the compiler and add the disposable library before adopting 2.x |

To upgrade:

1. Stop the complete worker pool and wait for every 1.x worker to exit.
2. Before loading 2.x, inspect any custom `Symbol.dispose` polyfill. It must be
   a valid own data-symbol with a compatible descriptor; inherited definitions
   and accessors are rejected, while a compatible mutable descriptor is
   permanently hardened during package loading.
3. Deploy one 2.x package copy to the main thread and all workers.
4. Remove the TypeScript `WorkerMutexOptions` import, use
   `WorkerMutexModeEnum`, pass `{ mode: WorkerMutexModeEnum.* }` directly, change
   `bindWorkerExit(worker, sharedBuffer)` to
   `bindWorkerExit({ worker, sharedBuffer })`, and update async calls to leases.
   `lock()` and `unlock()` keep their no-argument forms. The new
   `acquireAsync()` takes no arguments, while `runExclusive(callback)` takes
   its callback directly. In JavaScript, configuration, JSON,
   environment-derived values, worker messages, and comparisons with
   `mutex.mode`, replace lowercase mode strings with `'BLOCKING'` or `'ASYNC'`.
   Add `ESNext.Disposable` to the TypeScript `lib` list. Optional `using` call
   sites must be compiled before running on Node.js 10.
5. Create fresh 2.x buffers.
6. Bind each direct Worker on the main thread before sending any mutex buffer.

Rollback follows the same rule: stop the pool, restore 1.x everywhere, restore
the `WorkerMutexOptions` import, change the exit bind call back to its positional
form, remove `WorkerMutexModeEnum` usage, restore
the other 1.x API calls, and create fresh 1.x buffers. Never mix package
generations on one buffer. Buffers are process memory, so there is no
persistent-data conversion.

Replace `using` call sites with the 1.x-compatible manual `try`/`finally` flow
before rollback. Loading version 2 may permanently install or harden
`Symbol.dispose` for the lifetime of the current isolate, so a full process
restart is required to restore the previous global descriptor.

Do not hot-replace or mix different 2.x builds inside one running process. The
isolate registry has an internal ABI used by all physical package copies; a
coordinated process restart is required when upgrading or rolling back.

## Errors

All library errors are `WorkerMutexError` instances. The readonly
`error.code` is typed as `WorkerMutexErrorCodeEnum`. Each enum member name and
value are the same ordinary runtime string, and `error.message === error.code`.

```js
const {
  WorkerMutexError,
  WorkerMutexErrorCodeEnum,
} = require('worker-mutex');

try {
  mutex.lock();
} catch (error) {
  if (
    error instanceof WorkerMutexError &&
    error.code === WorkerMutexErrorCodeEnum.MUTEX_BLOCKING_LOCK_NOT_ALLOWED
  ) {
    // Handle this documented condition.
  } else {
    throw error;
  }
}
```

TypeScript callers constructing `WorkerMutexError` directly must pass an enum
member. JavaScript remains runtime-compatible with a raw string argument.

Runtime and registry errors:

- `WorkerMutexErrorCodeEnum.WORKER_THREADS_ARE_NOT_AVAILABLE`
- `WorkerMutexErrorCodeEnum.SHARED_ARRAY_BUFFER_IS_NOT_AVAILABLE`
- `WorkerMutexErrorCodeEnum.REQUIRED_ATOMICS_OPERATIONS_ARE_NOT_AVAILABLE`
- `WorkerMutexErrorCodeEnum.REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE`
- `WorkerMutexErrorCodeEnum.CRYPTO_RANDOM_IS_NOT_AVAILABLE`
- `WorkerMutexErrorCodeEnum.WORKER_MUTEX_REGISTRY_IS_INCOMPATIBLE`
- `WorkerMutexErrorCodeEnum.SYMBOL_DISPOSE_IS_NOT_AVAILABLE`

Buffer and mode errors:

- `WorkerMutexErrorCodeEnum.HANDLE_MUST_BE_A_SHARED_ARRAY_BUFFER`
- `WorkerMutexErrorCodeEnum.MUTEX_BUFFER_SIZE_MUST_MATCH_SINGLE_MUTEX`
- `WorkerMutexErrorCodeEnum.MUTEX_MODE_MUST_BE_BLOCKING_OR_ASYNC`
- `WorkerMutexErrorCodeEnum.MUTEX_BUFFER_LAYOUT_IS_NOT_SUPPORTED`
- `WorkerMutexErrorCodeEnum.MUTEX_BUFFER_MUST_NOT_BE_GROWABLE`
- `WorkerMutexErrorCodeEnum.MUTEX_BUFFER_ID_IS_INVALID`
- `WorkerMutexErrorCodeEnum.MUTEX_MODE_DOES_NOT_SUPPORT_BLOCKING`
- `WorkerMutexErrorCodeEnum.MUTEX_MODE_DOES_NOT_SUPPORT_ASYNC`

Ownership, lease, and state errors:

- `WorkerMutexErrorCodeEnum.MUTEX_BLOCKING_LOCK_NOT_ALLOWED`
- `WorkerMutexErrorCodeEnum.THREAD_ID_IS_OUT_OF_RANGE`
- `WorkerMutexErrorCodeEnum.MUTEX_LEASE_CONSTRUCTION_NOT_ALLOWED`
- `WorkerMutexErrorCodeEnum.MUTEX_LEASE_IS_NOT_ACTIVE`
- `WorkerMutexErrorCodeEnum.MUTEX_IS_NOT_OWNED_BY_CURRENT_THREAD`
- `WorkerMutexErrorCodeEnum.MUTEX_RECURSION_COUNT_UNDERFLOW`
- `WorkerMutexErrorCodeEnum.MUTEX_RECURSION_COUNT_OVERFLOW`
- `WorkerMutexErrorCodeEnum.MUTEX_STATE_IS_CORRUPTED`
- `WorkerMutexErrorCodeEnum.MUTEX_LOCAL_STATE_IS_INCONSISTENT`

Worker binding errors:

- `WorkerMutexErrorCodeEnum.WORKER_EXIT_BINDING_REQUIRES_MAIN_THREAD`
- `WorkerMutexErrorCodeEnum.WORKER_INSTANCE_MUST_SUPPORT_EXIT_EVENT`
- `WorkerMutexErrorCodeEnum.WORKER_THREAD_ID_MUST_BE_A_POSITIVE_INTEGER`
- `WorkerMutexErrorCodeEnum.WORKER_IS_ALREADY_EXITED`

## Trust boundary and limitations

- A shared buffer is a cooperative trust boundary, not a security sandbox. Any
  code that receives the `SharedArrayBuffer` can write its bytes directly and
  bypass or corrupt the mutex protocol. Share it only with trusted workers.
- A lease prevents accidental same-isolate ownership confusion; it does not
  defend against code that tampers with the shared buffer or library runtime.
- Loading the package may install or irreversibly harden the isolate's
  `Symbol.dispose`. Validate custom symbol polyfills before loading the package;
  inherited or incompatible definitions are rejected.
- The legacy `Symbol.dispose` shim is isolate- and realm-local. Moving leases
  across `vm` realms is unsupported.
- Automatic cleanup covers only a genuine exit of a direct, main-created Worker
  that was bound before receiving the buffer.
- Nested-worker cleanup through `bindWorkerExit()` is unsupported.
- Cleanup restores mutex liveness only. Protected user data may be partial,
  invalid, or semantically inconsistent after a worker exit.
- Removing/reordering EventEmitter listeners, disposing too early, or allowing
  the main process to exit can disable cleanup.
- Strict FIFO fairness between workers is not promised.
- Blocking mode intentionally cannot run on the main thread.
- Node.js 10 compatibility is not a security-support promise. Use a maintained
  LTS release for production.

## Local validation

The development toolchain requires Node.js `>=22.8.0` and npm `>=10.8.0`.
These commands validate the current checkout locally:

```bash
npm ci
npm run typecheck
npm test
npm run test:compat
npm run coverage
npm run package:check
npm run test:package
```

`test:compat` builds the package and runs a Node.js 10.5-compatible syntax and
API smoke suite under the current runtime's actual capability set. It does not
force the legacy wait/wake path and is not evidence that the exact Node.js 10.5
runtime executed.

`package:check` builds current sources and runs
`npm pack --dry-run --ignore-scripts`. `test:package` goes further: it creates a
real temporary tarball, installs it into a temporary consumer project, and runs
CommonJS, ESM-interop, and TypeScript declaration smoke checks with both the
minimum supported TypeScript 5.6 compiler and the current development compiler.
It also compiles and executes a real downlevel `using` consumer. Set
`WORKER_MUTEX_NODE_10_BIN` to run that emitted consumer with an exact Node.js
10.5.0 binary during the same package check. The script verifies the binary's
reported version before using it:

```bash
WORKER_MUTEX_NODE_10_BIN=/absolute/path/to/node-v10.5.0/bin/node npm run test:package
```

After building with the development toolchain, a locally installed Node.js
10.5.0 binary can run the dedicated compatibility smoke test:

```bash
npm run build
/absolute/path/to/node-v10.5.0/bin/node --experimental-worker test/compat/node-10.5.smoke.js "$PWD"
```

The commands above describe local validation only. This README makes no claim
that every supported runtime or platform is continuously exercised in CI.

## Official runtime references

- [Node.js 10.5.0 Worker Threads documentation](https://nodejs.org/download/release/v10.5.0/docs/api/worker_threads.html)
- [Node.js 10.6.0 release notes (`Atomics.notify` alias)](https://nodejs.org/en/blog/release/v10.6.0)
- [Current Worker Threads history](https://nodejs.org/api/worker_threads.html)
- [V8: `Atomics.wait`, `Atomics.notify`, and `Atomics.waitAsync`](https://v8.dev/features/atomics)
- [Node.js release status](https://nodejs.org/en/about/previous-releases)
- [Node.js end-of-life policy](https://nodejs.org/en/about/eol)
- [TypeScript explicit resource management](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html)
- [TC39 Explicit Resource Management](https://github.com/tc39/proposal-explicit-resource-management)

## License

MIT
