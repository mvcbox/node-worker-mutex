import type { LocalMutexState } from './LocalMutexState';
import type { PollTask } from './PollTask';
import type { WorkerBinding } from './WorkerBinding';
import type { IsolateRegistry } from './IsolateRegistry';
import type { ProcessWithRegistry } from './ProcessWithRegistry';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { isRegistry } from './is-registry';
import { REGISTRY_ABI_VERSION } from './mutex-constants';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

const REGISTRY_KEY = Symbol.for('worker-mutex.isolate-registry');
let cachedRegistry: IsolateRegistry | undefined;

export function getIsolateRegistry(): IsolateRegistry {
  if (cachedRegistry) {
    return cachedRegistry;
  }

  const host = process as ProcessWithRegistry;
  let existing: unknown;

  try {
    existing = host[REGISTRY_KEY];
  } catch (_cause) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.WORKER_MUTEX_REGISTRY_IS_INCOMPATIBLE);
  }

  if (existing !== undefined) {
    if (!isRegistry(existing)) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.WORKER_MUTEX_REGISTRY_IS_INCOMPATIBLE);
    }

    cachedRegistry = existing;
    return existing;
  }

  const created: IsolateRegistry = {
    abiVersion: REGISTRY_ABI_VERSION,
    mutexes: new Map<string, LocalMutexState>(),
    workers: new WeakMap<object, WorkerBinding>(),
    pollHeap: [],
    pollIndex: new Map<string, PollTask>(),
    pendingAsyncRequests: 0,
    keeperTimer: undefined,
    pollTimer: undefined,
    pollTimerDeadline: 0,
    pollTimerToken: 0,
    nextPollSequence: 0
  };

  try {
    Object.defineProperty(host, REGISTRY_KEY, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: created
    });
  } catch (_cause) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.WORKER_MUTEX_REGISTRY_IS_INCOMPATIBLE);
  }

  cachedRegistry = created;
  return created;
}
