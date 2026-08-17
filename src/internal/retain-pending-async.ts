import type { IsolateRegistry } from './IsolateRegistry';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { ensureKeeper } from './ensure-keeper';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function retainPendingAsync(reg: IsolateRegistry): void {
  const keeper = ensureKeeper(reg);

  if (reg.pendingAsyncRequests === 0) {
    try {
      keeper.ref();
    } catch (_cause) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE);
    }
  }

  reg.pendingAsyncRequests += 1;
}
