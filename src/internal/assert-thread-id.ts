import { WorkerMutexError } from '../errors/WorkerMutexError';
import { MAX_THREAD_ID } from './mutex-constants';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function assertThreadId(threadId: number, positiveOnly: boolean): void {
  if (!Number.isInteger(threadId) || (positiveOnly ? threadId <= 0 : threadId < 0)) {
    if (positiveOnly) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.WORKER_THREAD_ID_MUST_BE_A_POSITIVE_INTEGER);
    }

    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.THREAD_ID_IS_OUT_OF_RANGE);
  }

  if (threadId > MAX_THREAD_ID) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.THREAD_ID_IS_OUT_OF_RANGE);
  }
}
