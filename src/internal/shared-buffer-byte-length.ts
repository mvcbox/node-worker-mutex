import { WorkerMutexError } from '../errors/WorkerMutexError';
import { captureSharedBufferRuntime } from './capture-shared-buffer-runtime';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function sharedBufferByteLength(value: unknown): number {
  try {
    return captureSharedBufferRuntime().byteLength(value);
  } catch (_cause) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.HANDLE_MUST_BE_A_SHARED_ARRAY_BUFFER);
  }
}
