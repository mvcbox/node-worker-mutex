import type { IsolateRegistry } from './IsolateRegistry';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { captureTimers } from './capture-timers';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function releasePendingAsync(reg: IsolateRegistry): void {
  if (reg.pendingAsyncRequests <= 0) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_LOCAL_STATE_IS_INCONSISTENT);
  }

  if (reg.pendingAsyncRequests > 1) {
    reg.pendingAsyncRequests -= 1;
    return;
  }

  reg.pendingAsyncRequests = 0;
  const keeper = reg.keeperTimer;

  if (!keeper) {
    return;
  }

  try {
    keeper.unref();
  } catch (_cause) {
    try {
      captureTimers().clearTimeout(keeper.handle);
    } catch (_clearCause) {
      // Bound timer methods are validated before the first pending request.
    }

    reg.keeperTimer = undefined;
  }
}
