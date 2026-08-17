import type { AsyncRequest } from './AsyncRequest';
import type { LocalMutexState } from './LocalMutexState';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function takeQueueHead(state: LocalMutexState): AsyncRequest {
  const request = state.asyncQueue[state.asyncHead];

  if (request === undefined) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_LOCAL_STATE_IS_INCONSISTENT);
  }

  state.asyncQueue[state.asyncHead] = undefined;
  state.asyncHead += 1;

  if (state.asyncHead === state.asyncQueue.length) {
    state.asyncQueue = [];
    state.asyncHead = 0;
  } else if (state.asyncHead >= 1024 && state.asyncHead * 2 >= state.asyncQueue.length) {
    try {
      const compacted = state.asyncQueue.slice(state.asyncHead);
      state.asyncQueue = compacted;
      state.asyncHead = 0;
    } catch (_cause) {}
  }

  return request;
}
