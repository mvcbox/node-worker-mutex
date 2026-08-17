import type { WorkerRuntime } from './WorkerRuntime';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { findGetter } from './find-getter';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

let cachedWorkerRuntime: WorkerRuntime | undefined;

export function captureWorkerRuntime(): WorkerRuntime {
  if (cachedWorkerRuntime) {
    return cachedWorkerRuntime;
  }

  try {
    const workerThreads = require('worker_threads') as any;
    const events = require('events') as any;

    if (
      !workerThreads ||
      typeof workerThreads.Worker !== 'function' ||
      typeof workerThreads.isMainThread !== 'boolean' ||
      typeof workerThreads.threadId !== 'number'
    ) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.WORKER_THREADS_ARE_NOT_AVAILABLE);
    }

    const threadIdGetter = findGetter(workerThreads.Worker.prototype, 'threadId');
    const eventPrototype = events && events.EventEmitter && events.EventEmitter.prototype;

    if (
      typeof threadIdGetter !== 'function' ||
      !eventPrototype ||
      typeof eventPrototype.prependListener !== 'function' ||
      typeof eventPrototype.removeListener !== 'function'
    ) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.WORKER_THREADS_ARE_NOT_AVAILABLE);
    }

    const prependListener = eventPrototype.prependListener;
    const removeListener = eventPrototype.removeListener;

    cachedWorkerRuntime = {
      isMainThread: workerThreads.isMainThread,
      threadId: workerThreads.threadId,
      getWorkerThreadId: (worker: object): number => threadIdGetter.call(worker) as number,
      prependExitListener: (worker: object, listener: (exitCode: number) => void): void => {
        prependListener.call(worker, 'exit', listener);
      },
      removeExitListener: (worker: object, listener: (exitCode: number) => void): void => {
        removeListener.call(worker, 'exit', listener);
      }
    };
    return cachedWorkerRuntime;
  } catch (cause) {
    if (cause instanceof WorkerMutexError) {
      throw cause;
    }

    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.WORKER_THREADS_ARE_NOT_AVAILABLE);
  }
}
