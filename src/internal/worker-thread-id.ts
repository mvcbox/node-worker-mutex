import type { WorkerRuntime } from './WorkerRuntime';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function workerThreadId(worker: object, runtime: WorkerRuntime): number {
  try {
    return runtime.getWorkerThreadId(worker);
  } catch (_cause) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.WORKER_INSTANCE_MUST_SUPPORT_EXIT_EVENT);
  }
}
