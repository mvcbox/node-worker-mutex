import { WorkerMutexError } from '../errors/WorkerMutexError';
import { captureSharedBufferRuntime } from './capture-shared-buffer-runtime';
import { sharedBufferByteLength } from './shared-buffer-byte-length';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function assertNotGrowable(buffer: SharedArrayBuffer): void {
  const shared = captureSharedBufferRuntime();

  try {
    if (shared.growable && shared.growable(buffer) === true) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_BUFFER_MUST_NOT_BE_GROWABLE);
    }

    if (
      shared.maxByteLength &&
      shared.maxByteLength(buffer) !== sharedBufferByteLength(buffer)
    ) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_BUFFER_MUST_NOT_BE_GROWABLE);
    }
  } catch (cause) {
    if (cause instanceof WorkerMutexError) {
      throw cause;
    }

    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.HANDLE_MUST_BE_A_SHARED_ARRAY_BUFFER);
  }
}
