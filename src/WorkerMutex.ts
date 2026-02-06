import * as utils from './utils';
import { threadId } from 'worker_threads';
import { WorkerMutexError } from './errors';
import type { WorkerMutexOptions } from './WorkerMutexOptions';

export class WorkerMutex {
  private static readonly STRIDE = 3;
  private static readonly LOCK_OFFSET = 0;
  private static readonly OWNER_OFFSET = 1;
  private static readonly COUNT_OFFSET = 2;
  private static mainThreadWarningShown = false;
  private static readonly MAX_RECURSION_COUNT = 2147483647;
  private static readonly KEEP_ALIVE_TIMEOUT_MS = 2147483647;
  private static readonly BYTES_PER_MUTEX = Int32Array.BYTES_PER_ELEMENT * WorkerMutex.STRIDE;
  private static readonly MAX_MUTEX_COUNT = Math.floor(Number.MAX_SAFE_INTEGER / WorkerMutex.BYTES_PER_MUTEX);

  private readonly i32: Int32Array;
  private readonly base: number;

  public constructor(options: WorkerMutexOptions) {
    const handle = options.handle;
    const index = options.index ?? 0;
    utils.assertUnsignedInteger(index);

    if (!(handle instanceof SharedArrayBuffer)) {
      throw new WorkerMutexError('HANDLE_MUST_BE_A_SHARED_ARRAY_BUFFER');
    }

    if (handle.byteLength % Int32Array.BYTES_PER_ELEMENT !== 0) {
      throw new WorkerMutexError('HANDLE_BYTE_LENGTH_IS_NOT_INT32_ALIGNED');
    }

    const view = new Int32Array(handle);
    const base = index * WorkerMutex.STRIDE;

    if (index < 0 || base + (WorkerMutex.STRIDE - 1) >= view.length) {
      throw new WorkerMutexError('MUTEX_INDEX_OUT_OF_RANGE');
    }

    this.i32 = view;
    this.base = base;
  }

  public static createSharedBuffer(count: number = 1): SharedArrayBuffer {
    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new WorkerMutexError('COUNT_MUST_BE_A_POSITIVE_SAFE_INTEGER');
    }

    if (count > WorkerMutex.MAX_MUTEX_COUNT) {
      throw new WorkerMutexError('COUNT_EXCEEDS_MAX_SUPPORTED_VALUE');
    }

    return new SharedArrayBuffer(WorkerMutex.BYTES_PER_MUTEX * count);
  }

  public get buffer(): SharedArrayBuffer {
    return this.i32.buffer as SharedArrayBuffer;
  }

  public get index(): number {
    return this.base / WorkerMutex.STRIDE;
  }

  private ownerIndex(): number {
    return this.base + WorkerMutex.OWNER_OFFSET;
  }

  private lockIndex(): number {
    return this.base + WorkerMutex.LOCK_OFFSET;
  }

  private countIndex(): number {
    return this.base + WorkerMutex.COUNT_OFFSET;
  }

  private static selfId(): number {
    return threadId;
  }

  private static async sleep(delay: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }

  private static async awaitWaitAsync(value: Promise<string>): Promise<void> {
    const keepAliveTimer = setTimeout(() => undefined, WorkerMutex.KEEP_ALIVE_TIMEOUT_MS);

    try {
      await value;
    } finally {
      clearTimeout(keepAliveTimer);
    }
  }

  private incrementRecursionCount(ci: number): void {
    const a = this.i32;

    while (true) {
      const count = Atomics.load(a, ci);

      if (count <= 0) {
        throw new WorkerMutexError('MUTEX_RECURSION_COUNT_UNDERFLOW');
      }

      if (count >= WorkerMutex.MAX_RECURSION_COUNT) {
        throw new WorkerMutexError('MUTEX_RECURSION_COUNT_OVERFLOW');
      }

      if (Atomics.compareExchange(a, ci, count, count + 1) === count) {
        return;
      }
    }
  }

  public lock(): void {
    const a = this.i32;
    const fi = this.lockIndex();
    const oi = this.ownerIndex();
    const ci = this.countIndex();
    const me = WorkerMutex.selfId();

    if (threadId === 0 && !WorkerMutex.mainThreadWarningShown) {
      WorkerMutex.mainThreadWarningShown = true;
      process.emitWarning('WORKER_MUTEX_LOCK_ON_MAIN_THREAD_BLOCKS_EVENT_LOOP');
    }

    while (true) {
      const lock = Atomics.load(a, fi);
      const owner = Atomics.load(a, oi);

      if (lock === 1 && owner === me) {
        this.incrementRecursionCount(ci);
        return;
      }

      if (lock === 0) {
        if (Atomics.compareExchange(a, fi, 0, 1) === 0) {
          Atomics.store(a, oi, me);
          Atomics.store(a, ci, 1);
          return;
        }

        continue;
      }

      Atomics.wait(a, fi, lock);
    }
  }

  public async lockAsync(): Promise<void> {
    const a = this.i32;
    const fi = this.lockIndex();
    const oi = this.ownerIndex();
    const ci = this.countIndex();
    const me = WorkerMutex.selfId();
    let delay = 0;

    const anyAtomics = Atomics as unknown as {
      waitAsync?: (
        typedArray: Int32Array,
        index: number,
        value: number,
        timeout?: number
      ) => { async: boolean; value: Promise<string> | string };
    };

    if (typeof anyAtomics.waitAsync === 'function') {
      while (true) {
        const lock = Atomics.load(a, fi);
        const owner = Atomics.load(a, oi);

        if (lock === 1 && owner === me) {
          this.incrementRecursionCount(ci);
          return;
        }

        if (lock === 0) {
          if (Atomics.compareExchange(a, fi, 0, 1) === 0) {
            Atomics.store(a, oi, me);
            Atomics.store(a, ci, 1);
            return;
          }

          await WorkerMutex.sleep(delay);

          if (delay < 8) {
            delay += 1;
          }

          continue;
        }

        const res = anyAtomics.waitAsync(a, fi, lock);

        if (res && res.value && typeof (res.value as any).then === 'function') {
          await WorkerMutex.awaitWaitAsync(res.value as Promise<string>);
          delay = 0;
        } else {
          await WorkerMutex.sleep(delay);

          if (delay < 8) {
            delay += 1;
          }
        }
      }
    }

    delay = 0;

    while (true) {
      const lock = Atomics.load(a, fi);
      const owner = Atomics.load(a, oi);

      if (lock === 1 && owner === me) {
        this.incrementRecursionCount(ci);
        return;
      }

      if (lock === 0) {
        if (Atomics.compareExchange(a, fi, 0, 1) === 0) {
          Atomics.store(a, oi, me);
          Atomics.store(a, ci, 1);
          return;
        }

        await WorkerMutex.sleep(delay);

        if (delay < 8) {
          delay += 1;
        }

        continue;
      }

      await WorkerMutex.sleep(delay);

      if (delay < 8) {
        delay += 1;
      }
    }
  }

  public unlock(): void {
    const a = this.i32;
    const fi = this.lockIndex();
    const oi = this.ownerIndex();
    const ci = this.countIndex();
    const me = WorkerMutex.selfId();

    const lock = Atomics.load(a, fi);
    const owner = Atomics.load(a, oi);

    if (lock !== 1 || owner !== me) {
      throw new WorkerMutexError('MUTEX_IS_NOT_OWNED_BY_CURRENT_THREAD');
    }

    while (true) {
      const count = Atomics.load(a, ci);

      if (count <= 0) {
        throw new WorkerMutexError('MUTEX_RECURSION_COUNT_UNDERFLOW');
      }

      const nextCount = count - 1;

      if (Atomics.compareExchange(a, ci, count, nextCount) !== count) {
        continue;
      }

      if (nextCount > 0) {
        return;
      }

      Atomics.store(a, ci, 0);
      Atomics.store(a, oi, 0);
      Atomics.store(a, fi, 0);
      Atomics.notify(a, fi, 1);
      return;
    }
  }
}
