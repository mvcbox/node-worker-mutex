import { WorkerMutexModeEnum } from '../WorkerMutexModeEnum';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { MODE_BLOCKING, MODE_ASYNC } from './mutex-constants';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function modeCell(mode: WorkerMutexModeEnum): number {
  if (mode === WorkerMutexModeEnum.BLOCKING) {
    return MODE_BLOCKING;
  }

  if (mode === WorkerMutexModeEnum.ASYNC) {
    return MODE_ASYNC;
  }

  throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_MODE_MUST_BE_BLOCKING_OR_ASYNC);
}
