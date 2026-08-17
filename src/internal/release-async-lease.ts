import type { AtomicsAdapter } from './AtomicsAdapter';
import type { LocalMutexState } from './LocalMutexState';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { captureWorkerRuntime } from './capture-worker-runtime';
import { ownerToken } from './owner-token';
import { wakeAll } from './wake-all';
import { OWNER_OFFSET, RECURSION_OFFSET, OWNER_FREE } from './mutex-constants';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function releaseAsyncLease(
  state: LocalMutexState,
  i32: Int32Array,
  atomics: AtomicsAdapter,
  leaseId: number,
  token: number
): void {
  if (
    state.activeLeaseId !== leaseId ||
    token !== ownerToken(captureWorkerRuntime().threadId) ||
    atomics.load(i32, OWNER_OFFSET) !== token
  ) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_LEASE_IS_NOT_ACTIVE);
  }

  const recursion = atomics.load(i32, RECURSION_OFFSET);

  if (recursion <= 0) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_RECURSION_COUNT_UNDERFLOW);
  }

  if (recursion !== 1) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_LOCAL_STATE_IS_INCONSISTENT);
  }

  atomics.store(i32, RECURSION_OFFSET, 0);

  if (atomics.compareExchange(i32, OWNER_OFFSET, token, OWNER_FREE) !== token) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_LEASE_IS_NOT_ACTIVE);
  }

  state.activeLeaseId = 0;
  wakeAll(i32, atomics, false);
}
