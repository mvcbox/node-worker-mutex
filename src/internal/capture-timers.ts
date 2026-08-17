import type { TimerRuntime } from './TimerRuntime';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

let cachedTimerRuntime: TimerRuntime | undefined;

export function captureTimers(): TimerRuntime {
  if (cachedTimerRuntime) {
    return cachedTimerRuntime;
  }

  try {
    if (
      typeof setTimeout !== 'function' ||
      typeof clearTimeout !== 'function' ||
      typeof process.hrtime !== 'function'
    ) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE);
    }

    const capturedSetTimeout = setTimeout;
    const capturedClearTimeout = clearTimeout;
    const capturedHrtime = process.hrtime.bind(process);
    const now = (): number => {
      const value = capturedHrtime();

      if (
        !Array.isArray(value) ||
        value.length < 2 ||
        !Number.isFinite(value[0]) ||
        !Number.isFinite(value[1])
      ) {
        throw new WorkerMutexError(WorkerMutexErrorCodeEnum.REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE);
      }

      return (value[0] * 1000) + (value[1] / 1000000);
    };
    now();
    cachedTimerRuntime = {
      setTimeout: (callback: () => void, delay: number): any => capturedSetTimeout(callback, delay),
      clearTimeout: (handle: any): void => capturedClearTimeout(handle),
      now
    };
    return cachedTimerRuntime;
  } catch (cause) {
    if (cause instanceof WorkerMutexError) {
      throw cause;
    }

    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE);
  }
}
