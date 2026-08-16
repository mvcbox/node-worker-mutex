import type { KeeperTimer } from './KeeperTimer';
import type { IsolateRegistry } from './IsolateRegistry';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { captureTimers } from './capture-timers';
import { KEEP_ALIVE_TIMEOUT_MS } from './mutex-constants';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function ensureKeeper(reg: IsolateRegistry): KeeperTimer {
  if (reg.keeperTimer !== undefined) {
    return reg.keeperTimer;
  }

  const timers = captureTimers();
  let handle: any;
  let keeper: KeeperTimer | undefined;
  // The keeper controls process liveness; polling uses a separate isolate-wide unref timer.
  const refresh = (): void => {
    if (!keeper) {
      return;
    }

    keeper.refresh();

    if (reg.pendingAsyncRequests === 0) {
      keeper.unref();
    }
  };
  try {
    handle = timers.setTimeout(refresh, KEEP_ALIVE_TIMEOUT_MS);

    if (
      !handle ||
      typeof handle.ref !== 'function' ||
      typeof handle.unref !== 'function' ||
      typeof handle.refresh !== 'function'
    ) {
      try {
        timers.clearTimeout(handle);
      } catch (_cause) {
        // The typed capability error below is the public failure contract.
      }

      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE);
    }

    keeper = {
      handle,
      ref: handle.ref.bind(handle),
      unref: handle.unref.bind(handle),
      refresh: handle.refresh.bind(handle)
    };
    keeper.unref();
    reg.keeperTimer = keeper;
    return keeper;
  } catch (cause) {
    if (handle !== undefined) {
      try {
        timers.clearTimeout(handle);
      } catch (_clearCause) {}
    }

    if (cause instanceof WorkerMutexError) {
      throw cause;
    }

    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE);
  }
}
