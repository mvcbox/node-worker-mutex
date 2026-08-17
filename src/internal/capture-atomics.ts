import type { AtomicsAdapter } from './AtomicsAdapter';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { captureSharedBufferRuntime } from './capture-shared-buffer-runtime';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

let cachedAtomics: AtomicsAdapter | undefined;

export function captureAtomics(): AtomicsAdapter {
  if (cachedAtomics) {
    return cachedAtomics;
  }

  try {
    if (typeof Atomics !== 'object' || Atomics === null) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.REQUIRED_ATOMICS_OPERATIONS_ARE_NOT_AVAILABLE);
    }

    const source = Atomics as any;
    const required = ['load', 'store', 'add', 'compareExchange', 'wait'];

    for (let index = 0; index < required.length; index += 1) {
      if (typeof source[required[index]] !== 'function') {
        throw new WorkerMutexError(WorkerMutexErrorCodeEnum.REQUIRED_ATOMICS_OPERATIONS_ARE_NOT_AVAILABLE);
      }
    }

    const core = {
      load: source.load.bind(source),
      store: source.store.bind(source),
      add: source.add.bind(source),
      compareExchange: source.compareExchange.bind(source),
      wait: source.wait.bind(source)
    };
    const probe = new Int32Array(
      captureSharedBufferRuntime().create(Int32Array.BYTES_PER_ELEMENT)
    );

    if (
      core.load(probe, 0) !== 0 ||
      core.store(probe, 0, 1) !== 1 ||
      core.compareExchange(probe, 0, 1, 2) !== 1 ||
      core.add(probe, 0, 1) !== 2 ||
      core.load(probe, 0) !== 3 ||
      core.wait(probe, 0, 4, 0) !== 'not-equal'
    ) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.REQUIRED_ATOMICS_OPERATIONS_ARE_NOT_AVAILABLE);
    }

    const wakeCandidates = [source.notify, source.wake];
    let wake: ((array: Int32Array, index: number, count?: number) => number) | undefined;

    for (let index = 0; index < wakeCandidates.length; index += 1) {
      const candidate = wakeCandidates[index];

      if (typeof candidate !== 'function') {
        continue;
      }

      const bound = candidate.bind(source);

      try {
        if (typeof bound(probe, 0, 0) === 'number') {
          wake = bound;
          break;
        }
      } catch (_cause) {
        continue;
      }
    }

    if (!wake) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.REQUIRED_ATOMICS_OPERATIONS_ARE_NOT_AVAILABLE);
    }

    const adapter: AtomicsAdapter = {
      ...core,
      wake,
      waitAsync: typeof source.waitAsync === 'function' ? source.waitAsync.bind(source) : undefined,
      waitAsyncUsable: typeof source.waitAsync === 'function'
    };

    cachedAtomics = adapter;
    return adapter;
  } catch (cause) {
    if (cause instanceof WorkerMutexError) {
      throw cause;
    }

    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.REQUIRED_ATOMICS_OPERATIONS_ARE_NOT_AVAILABLE);
  }
}
