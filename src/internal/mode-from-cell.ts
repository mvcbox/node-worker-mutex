import { WorkerMutexModeEnum } from '../WorkerMutexModeEnum';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { MODE_BLOCKING, MODE_ASYNC } from './mutex-constants';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function modeFromCell(value: number): WorkerMutexModeEnum {
  if (value === MODE_BLOCKING) {
    return WorkerMutexModeEnum.BLOCKING;
  }

  if (value === MODE_ASYNC) {
    return WorkerMutexModeEnum.ASYNC;
  }

  throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_BUFFER_LAYOUT_IS_NOT_SUPPORTED);
}
