import type { WorkerMutexErrorCodeEnum } from './WorkerMutexErrorCodeEnum';

export class WorkerMutexError extends Error {
  public readonly code: WorkerMutexErrorCodeEnum;

  public constructor(code: WorkerMutexErrorCodeEnum) {
    super(code);
    this.code = code;
    this.name = 'WorkerMutexError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WorkerMutexError);
    }
  }
}
