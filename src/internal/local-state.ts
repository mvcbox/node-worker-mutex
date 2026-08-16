import type { LocalMutexState } from './LocalMutexState';
import type { WorkerMutexModeEnum } from '../WorkerMutexModeEnum';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { getIsolateRegistry } from './get-isolate-registry';
import { OWNER_FREE, MIN_POLL_MS } from './mutex-constants';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function localState(id: string, mode: WorkerMutexModeEnum): LocalMutexState {
  const mutexes = getIsolateRegistry().mutexes;
  const existing = mutexes.get(id);

  if (existing) {
    if (existing.mode !== mode) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_LOCAL_STATE_IS_INCONSISTENT);
    }

    return existing;
  }

  const created: LocalMutexState = {
    id,
    mode,
    blockingDepth: 0,
    blockingOwner: OWNER_FREE,
    asyncQueue: [],
    asyncHead: 0,
    asyncRunnerActive: false,
    activeLeaseId: 0,
    nextLeaseId: 1,
    pollBackoffMs: MIN_POLL_MS,
    pollJitterState: 0
  };
  mutexes.set(id, created);
  return created;
}
