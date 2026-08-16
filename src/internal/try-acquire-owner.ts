import type { AtomicsAdapter } from './AtomicsAdapter';
import type { LocalMutexState } from './LocalMutexState';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { isValidOwner } from './is-valid-owner';
import { rollbackExactOwner } from './rollback-exact-owner';
import { OWNER_OFFSET, RECURSION_OFFSET, OWNER_FREE, MIN_POLL_MS } from './mutex-constants';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function tryAcquireOwner(
  state: LocalMutexState,
  i32: Int32Array,
  atomics: AtomicsAdapter,
  token: number
): boolean {
  const observed = atomics.compareExchange(i32, OWNER_OFFSET, OWNER_FREE, token);

  if (observed === OWNER_FREE) {
    try {
      atomics.store(i32, RECURSION_OFFSET, 1);
      state.pollBackoffMs = MIN_POLL_MS;
      return true;
    } catch (cause) {
      rollbackExactOwner(i32, atomics, token);
      throw cause;
    }
  }

  if (!isValidOwner(observed)) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_STATE_IS_CORRUPTED);
  }

  if (observed === token && state.blockingDepth === 0 && state.activeLeaseId === 0) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_LOCAL_STATE_IS_INCONSISTENT);
  }

  return false;
}
