import type { AcquireAsyncOutputDTO } from './acquire-async';
import type { BindWorkerExitInputDTO, BindWorkerExitOutputDTO } from './bind-worker-exit';
import type { CreateSharedBufferInputDTO, CreateSharedBufferOutputDTO } from './create-shared-buffer';
import type { AtomicsAdapter } from '../internal/AtomicsAdapter';
import type { BoundBuffer } from '../internal/BoundBuffer';
import type { LockOutputDTO } from './lock';
import type { RunExclusiveOutputDTO } from './run-exclusive';
import type { UnlockOutputDTO } from './unlock';
import type { WorkerMutexLease } from '../WorkerMutexLease';
import { WorkerMutexErrorCodeEnum, WorkerMutexError } from '../errors';
import { WorkerMutexModeEnum } from '../WorkerMutexModeEnum';
import { captureSharedBufferRuntime } from '../internal/capture-shared-buffer-runtime';
import { captureAtomics } from '../internal/capture-atomics';
import { captureWorkerRuntime } from '../internal/capture-worker-runtime';
import { assertRuntimeCapabilities } from '../internal/assert-runtime-capabilities';
import { getIsolateRegistry } from '../internal/get-isolate-registry';
import { modeCell } from '../internal/mode-cell';
import { parseSharedBuffer } from '../internal/parse-shared-buffer';
import { randomIdWords } from '../internal/random-id-words';
import { assertThreadId } from '../internal/assert-thread-id';
import { ownerToken } from '../internal/owner-token';
import { localState } from '../internal/local-state';
import { pruneLocalState } from '../internal/prune-local-state';
import { retainPendingAsync } from '../internal/retain-pending-async';
import { wakeAll } from '../internal/wake-all';
import { tryAcquireOwner } from '../internal/try-acquire-owner';
import { pumpAsyncQueue } from '../internal/pump-async-queue';
import { createWorkerMutexLease } from '../internal/create-worker-mutex-lease';
import { handleWorkerExit } from '../internal/handle-worker-exit';
import { workerThreadId } from '../internal/worker-thread-id';
import {
  MAGIC,
  VERSION,
  MAGIC_OFFSET,
  VERSION_OFFSET,
  MODE_OFFSET,
  ID_OFFSET,
  ID_WORDS,
  OWNER_OFFSET,
  RECURSION_OFFSET,
  WAKE_EPOCH_OFFSET,
  BYTES_PER_MUTEX,
  OWNER_FREE,
  MAX_RECURSION_COUNT,
  WAIT_WATCHDOG_MS
} from '../internal/mutex-constants';

export class WorkerMutex {
  private readonly buffer: SharedArrayBuffer;
  private readonly i32: Int32Array;
  private readonly id: string;
  private readonly atomics: AtomicsAdapter;
  public readonly mode: WorkerMutexModeEnum;

  public constructor(sharedBuffer: SharedArrayBuffer) {
    const parsed = parseSharedBuffer(sharedBuffer);
    this.buffer = sharedBuffer;
    this.i32 = parsed.i32;
    this.id = parsed.id;
    this.mode = parsed.mode;
    this.atomics = parsed.atomics;
  }

  public static createSharedBuffer(
    input: CreateSharedBufferInputDTO
  ): CreateSharedBufferOutputDTO {
    assertRuntimeCapabilities();

    if (!input || typeof input !== 'object') {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_MODE_MUST_BE_BLOCKING_OR_ASYNC);
    }

    const mode = modeCell(input.mode);
    const id = randomIdWords();
    const buffer = captureSharedBufferRuntime().create(BYTES_PER_MUTEX);
    const i32 = new Int32Array(buffer);
    const atomics = captureAtomics();
    atomics.store(i32, MAGIC_OFFSET, MAGIC);
    atomics.store(i32, VERSION_OFFSET, VERSION);
    atomics.store(i32, MODE_OFFSET, mode);

    for (let index = 0; index < ID_WORDS; index += 1) {
      atomics.store(i32, ID_OFFSET + index, id[index]);
    }

    return buffer;
  }

  public static bindWorkerExit(input: BindWorkerExitInputDTO): BindWorkerExitOutputDTO {
    const runtime = captureWorkerRuntime();

    if (!runtime.isMainThread) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.WORKER_EXIT_BINDING_REQUIRES_MAIN_THREAD);
    }

    assertRuntimeCapabilities();

    if (!input || typeof input !== 'object') {
      throw new WorkerMutexError(
        WorkerMutexErrorCodeEnum.WORKER_INSTANCE_MUST_SUPPORT_EXIT_EVENT
      );
    }

    const worker = input.worker;
    const sharedBuffer = input.sharedBuffer;
    const workerId = workerThreadId(worker as unknown as object, runtime);

    if (workerId === -1) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.WORKER_IS_ALREADY_EXITED);
    }

    assertThreadId(workerId, true);
    const parsed = parseSharedBuffer(sharedBuffer);
    const reg = getIsolateRegistry();
    let binding = reg.workers.get(worker as unknown as object);

    if (!binding) {
      const listener = (): void => {
        if (binding) {
          handleWorkerExit(worker as unknown as object, runtime, reg, binding);
        }
      };
      binding = {
        workerId,
        ownerToken: ownerToken(workerId),
        listener,
        buffers: new Map<SharedArrayBuffer, BoundBuffer>(),
        active: true
      };
      reg.workers.set(worker as unknown as object, binding);

      try {
        runtime.prependExitListener(worker as unknown as object, listener);
      } catch (_cause) {
        binding.active = false;
        reg.workers.delete(worker as unknown as object);

        try {
          runtime.removeExitListener(worker as unknown as object, listener);
        } catch (_detachCause) {
          // The attach capability error remains the public failure contract.
        }

        throw new WorkerMutexError(WorkerMutexErrorCodeEnum.WORKER_INSTANCE_MUST_SUPPORT_EXIT_EVENT);
      }

      let postAttachThreadId: number;

      try {
        postAttachThreadId = workerThreadId(worker as unknown as object, runtime);
      } catch (cause) {
        binding.active = false;
        reg.workers.delete(worker as unknown as object);

        try {
          runtime.removeExitListener(worker as unknown as object, listener);
        } catch (_detachCause) {
          // The intrinsic brand error from the post-attach check has priority.
        }

        throw cause;
      }

      if (postAttachThreadId === -1 || !binding.active) {
        if (binding.active) {
          binding.active = false;
          reg.workers.delete(worker as unknown as object);
          runtime.removeExitListener(worker as unknown as object, listener);
        }

        throw new WorkerMutexError(WorkerMutexErrorCodeEnum.WORKER_IS_ALREADY_EXITED);
      }
    } else if (!binding.active || binding.workerId !== workerId) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.WORKER_IS_ALREADY_EXITED);
    }

    const existing = binding.buffers.get(sharedBuffer);

    if (existing) {
      existing.references += 1;
    } else {
      binding.buffers.set(sharedBuffer, {
        i32: parsed.i32,
        atomics: parsed.atomics,
        references: 1
      });
    }

    let disposed = false;

    return (): void => {
      if (disposed) {
        return;
      }

      disposed = true;

      if (!binding || !binding.active) {
        return;
      }

      const tracked = binding.buffers.get(sharedBuffer);

      if (!tracked) {
        return;
      }

      tracked.references -= 1;

      if (tracked.references <= 0) {
        binding.buffers.delete(sharedBuffer);
      }

      if (binding.buffers.size === 0) {
        binding.active = false;
        reg.workers.delete(worker as unknown as object);
        runtime.removeExitListener(worker as unknown as object, binding.listener);
      }
    };
  }

  public get sharedBuffer(): SharedArrayBuffer {
    return this.buffer;
  }

  public lock(): LockOutputDTO {
    if (this.mode !== WorkerMutexModeEnum.BLOCKING) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_MODE_DOES_NOT_SUPPORT_BLOCKING);
    }

    const runtime = captureWorkerRuntime();

    if (runtime.isMainThread) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_BLOCKING_LOCK_NOT_ALLOWED);
    }

    const token = ownerToken(runtime.threadId);
    const state = localState(this.id, this.mode);

    if (state.blockingDepth > 0) {
      if (state.blockingOwner !== token || this.atomics.load(this.i32, OWNER_OFFSET) !== token) {
        throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_LOCAL_STATE_IS_INCONSISTENT);
      }

      while (true) {
        const count = this.atomics.load(this.i32, RECURSION_OFFSET);

        if (count <= 0) {
          throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_RECURSION_COUNT_UNDERFLOW);
        }

        if (count >= MAX_RECURSION_COUNT) {
          throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_RECURSION_COUNT_OVERFLOW);
        }

        if (
          this.atomics.compareExchange(this.i32, RECURSION_OFFSET, count, count + 1) === count
        ) {
          state.blockingDepth = count + 1;
          return;
        }
      }
    }

    try {
      while (true) {
        if (tryAcquireOwner(state, this.i32, this.atomics, token)) {
          state.blockingOwner = token;
          state.blockingDepth = 1;
          return;
        }

        const epoch = this.atomics.load(this.i32, WAKE_EPOCH_OFFSET);

        if (tryAcquireOwner(state, this.i32, this.atomics, token)) {
          state.blockingOwner = token;
          state.blockingDepth = 1;
          return;
        }

        this.atomics.wait(this.i32, WAKE_EPOCH_OFFSET, epoch, WAIT_WATCHDOG_MS);
      }
    } catch (cause) {
      pruneLocalState(state);
      throw cause;
    }
  }

  public unlock(): UnlockOutputDTO {
    if (this.mode !== WorkerMutexModeEnum.BLOCKING) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_MODE_DOES_NOT_SUPPORT_BLOCKING);
    }

    const token = ownerToken(captureWorkerRuntime().threadId);
    const state = localState(this.id, this.mode);

    if (
      state.blockingDepth <= 0 ||
      state.blockingOwner !== token ||
      this.atomics.load(this.i32, OWNER_OFFSET) !== token
    ) {
      pruneLocalState(state);
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_IS_NOT_OWNED_BY_CURRENT_THREAD);
    }

    while (true) {
      const count = this.atomics.load(this.i32, RECURSION_OFFSET);

      if (count <= 0) {
        throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_RECURSION_COUNT_UNDERFLOW);
      }

      if (count > 1) {
        if (
          this.atomics.compareExchange(this.i32, RECURSION_OFFSET, count, count - 1) !== count
        ) {
          continue;
        }

        state.blockingDepth = count - 1;
        return;
      }

      this.atomics.store(this.i32, RECURSION_OFFSET, 0);

      if (this.atomics.compareExchange(this.i32, OWNER_OFFSET, token, OWNER_FREE) !== token) {
        throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_IS_NOT_OWNED_BY_CURRENT_THREAD);
      }

      state.blockingDepth = 0;
      state.blockingOwner = OWNER_FREE;
      wakeAll(this.i32, this.atomics, false);
      pruneLocalState(state);
      return;
    }
  }

  public acquireAsync(): Promise<AcquireAsyncOutputDTO> {
    if (this.mode !== WorkerMutexModeEnum.ASYNC) {
      return Promise.reject(new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_MODE_DOES_NOT_SUPPORT_ASYNC));
    }

    try {
      const reg = getIsolateRegistry();
      const state = localState(this.id, this.mode);

      try {
        retainPendingAsync(reg);
      } catch (cause) {
        pruneLocalState(state);
        return Promise.reject(cause);
      }

      return new Promise<WorkerMutexLease>((resolve, reject) => {
        state.asyncQueue.push({
          expectedBuffer: this.i32,
          createLease: createWorkerMutexLease,
          resolve,
          reject
        });
        pumpAsyncQueue(state);
      });
    } catch (cause) {
      return Promise.reject(cause);
    }
  }

  public async runExclusive<T>(
    callback: (lease: WorkerMutexLease) => T | PromiseLike<T>
  ): Promise<RunExclusiveOutputDTO<T>> {
    const lease = await this.acquireAsync();

    try {
      return await callback(lease);
    } finally {
      if (!lease.released) {
        lease.release();
      }
    }
  }
}
