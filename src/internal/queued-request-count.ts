import type { LocalMutexState } from './LocalMutexState';

export function queuedRequestCount(state: LocalMutexState): number {
  return state.asyncQueue.length - state.asyncHead;
}
