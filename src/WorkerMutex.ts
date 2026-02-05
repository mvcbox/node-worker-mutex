import * as utils from './utils';
import { threadId } from 'worker_threads';
import { WorkerMutexError } from './errors';
import type { WorkerMutexOptions } from './WorkerMutexOptions';

export class WorkerMutex {
  private static readonly STRIDE = 2;
  private static readonly OWNER_OFFSET = 0;
  private static readonly COUNT_OFFSET = 1;

  private readonly i32: Int32Array;
  private readonly base: number;

  public constructor(options: WorkerMutexOptions) {
    const handle = options.handle;
    const index = options.index ?? 0;
    utils.assertUnsignedInteger(index);

    if (!(handle instanceof SharedArrayBuffer)) {
      throw new WorkerMutexError('HANDLE_MUST_BE_A_SHARED_ARRAY_BUFFER');
    }

    const view = new Int32Array(handle);
    const base = index * WorkerMutex.STRIDE;

    if (index < 0 || base + (WorkerMutex.STRIDE - 1) >= view.length) {
      throw new WorkerMutexError('MUTEX_INDEX_OUT_OF_RANGE');
    }

    this.i32 = view;
    this.base = base;
  }

  static createSharedBuffer(count: number = 1): SharedArrayBuffer {
    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new WorkerMutexError("COUNT_MUST_BE_A_POSITIVE_INTEGER");
    }

    return new SharedArrayBuffer(
      Int32Array.BYTES_PER_ELEMENT * count * WorkerMutex.STRIDE
    );
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

  private countIndex(): number {
    return this.base + WorkerMutex.COUNT_OFFSET;
  }

  private static selfId(): number {
    return (threadId | 0) + 1;
  }

  lock(): void {
    const a = this.i32;
    const oi = this.ownerIndex();
    const ci = this.countIndex();
    const me = WorkerMutex.selfId();

    while (true) {
      const owner = Atomics.load(a, oi);

      if (owner === me) {
        Atomics.add(a, ci, 1);
        return;
      }

      if (owner === 0) {
        if (Atomics.compareExchange(a, oi, 0, me) === 0) {
          Atomics.store(a, ci, 1);
          return;
        }

        continue;
      }

      Atomics.wait(a, oi, owner);
    }
  }

  async lockAsync(): Promise<void> {
    const a = this.i32;
    const oi = this.ownerIndex();
    const ci = this.countIndex();
    const me = WorkerMutex.selfId();

    const owner0 = Atomics.load(a, oi);

    if (owner0 === me) {
      Atomics.add(a, ci, 1);
      return;
    }

    if (owner0 === 0 && Atomics.compareExchange(a, oi, 0, me) === 0) {
      Atomics.store(a, ci, 1);
      return;
    }

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
        const owner = Atomics.load(a, oi);

        if (owner === me) {
          Atomics.add(a, ci, 1);
          return;
        }

        if (owner === 0 && Atomics.compareExchange(a, oi, 0, me) === 0) {
          Atomics.store(a, ci, 1);
          return;
        }

        const res = anyAtomics.waitAsync(a, oi, owner);

        if (res && res.value && typeof (res.value as any).then === 'function') {
          await res.value;
        } else {
          // "not-equal"/"timed-out" и т.п.
          await Promise.resolve();
        }
      }
    }

    let delay = 0;

    while (true) {
      const owner = Atomics.load(a, oi);

      if (owner === me) {
        Atomics.add(a, ci, 1);
        return;
      }

      if (owner === 0 && Atomics.compareExchange(a, oi, 0, me) === 0) {
        Atomics.store(a, ci, 1);
        return;
      }

      await new Promise<void>((r) => setTimeout(r, delay));

      if (delay < 8) {
        delay += 1;
      }
    }
  }

  unlock(): void {
    const a = this.i32;
    const oi = this.ownerIndex();
    const ci = this.countIndex();
    const me = WorkerMutex.selfId();

    const owner = Atomics.load(a, oi);

    if (owner !== me) {
      throw new WorkerMutexError("MUTEX_IS_NOT_OWNED_BY_CURRENT_THREAD");
    }

    const prevCount = Atomics.sub(a, ci, 1);
    const newCount = prevCount - 1;

    if (newCount > 0) {
      return;
    }

    Atomics.store(a, ci, 0);
    Atomics.store(a, oi, 0);
    Atomics.notify(a, oi, 1);
  }
}
