import type { LocalMutexState } from './LocalMutexState';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { POLL_JITTER_MS } from './mutex-constants';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function nextPollJitter(state: LocalMutexState, threadId: number): number {
  let value = state.pollJitterState;

  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_LOCAL_STATE_IS_INCONSISTENT);
  }

  if (value === 0) {
    value = Math.imul(threadId + 1, 0x9e3779b1) >>> 0;

    for (let offset = 0; offset < state.id.length; offset += 8) {
      const word = parseInt(state.id.slice(offset, offset + 8), 16) >>> 0;
      value = Math.imul((value ^ word) >>> 0, 0x85ebca6b) >>> 0;
      value = (value ^ (value >>> 13)) >>> 0;
    }

    // Xorshift32 must never start from its absorbing zero state.
    value = value || 0x6d2b79f5;
  }

  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  value >>>= 0;
  state.pollJitterState = value;
  return value % POLL_JITTER_MS;
}
