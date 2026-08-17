import type { SharedBufferRuntime } from './SharedBufferRuntime';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

let cachedSharedBufferRuntime: SharedBufferRuntime | undefined;

export function captureSharedBufferRuntime(): SharedBufferRuntime {
  if (cachedSharedBufferRuntime) {
    return cachedSharedBufferRuntime;
  }

  try {
    if (typeof SharedArrayBuffer !== 'function') {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.SHARED_ARRAY_BUFFER_IS_NOT_AVAILABLE);
    }

    const Constructor = SharedArrayBuffer as any;
    const prototype = Constructor.prototype;
    const byteLengthDescriptor = Object.getOwnPropertyDescriptor(prototype, 'byteLength');

    if (!byteLengthDescriptor || typeof byteLengthDescriptor.get !== 'function') {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.SHARED_ARRAY_BUFFER_IS_NOT_AVAILABLE);
    }

    const byteLengthGetter = byteLengthDescriptor.get;
    const growableDescriptor = Object.getOwnPropertyDescriptor(prototype, 'growable');
    const maximumDescriptor = Object.getOwnPropertyDescriptor(prototype, 'maxByteLength');
    const runtime: SharedBufferRuntime = {
      create: (byteLength: number): SharedArrayBuffer => new Constructor(byteLength),
      byteLength: (value: unknown): number => byteLengthGetter.call(value) as number,
      growable: growableDescriptor && typeof growableDescriptor.get === 'function'
        ? (value: SharedArrayBuffer): boolean => growableDescriptor.get!.call(value) as boolean
        : undefined,
      maxByteLength: maximumDescriptor && typeof maximumDescriptor.get === 'function'
        ? (value: SharedArrayBuffer): number => maximumDescriptor.get!.call(value) as number
        : undefined
    };
    const probe = runtime.create(Int32Array.BYTES_PER_ELEMENT);

    if (
      runtime.byteLength(probe) !== Int32Array.BYTES_PER_ELEMENT ||
      (runtime.growable && typeof runtime.growable(probe) !== 'boolean') ||
      (runtime.maxByteLength && runtime.maxByteLength(probe) !== Int32Array.BYTES_PER_ELEMENT)
    ) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.SHARED_ARRAY_BUFFER_IS_NOT_AVAILABLE);
    }

    cachedSharedBufferRuntime = runtime;
    return runtime;
  } catch (cause) {
    if (cause instanceof WorkerMutexError) {
      throw cause;
    }

    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.SHARED_ARRAY_BUFFER_IS_NOT_AVAILABLE);
  }
}
