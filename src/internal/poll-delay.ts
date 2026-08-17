import type { LocalMutexState } from './LocalMutexState';
import { captureWorkerRuntime } from './capture-worker-runtime';
import { nextPollJitter } from './next-poll-jitter';
import { MAX_POLL_MS } from './mutex-constants';

export function pollDelay(state: LocalMutexState): number {
  const isolateSeed = captureWorkerRuntime().threadId;
  const jitter = nextPollJitter(state, isolateSeed);
  const delay = state.pollBackoffMs >= MAX_POLL_MS
    ? MAX_POLL_MS - jitter
    : Math.min(MAX_POLL_MS, state.pollBackoffMs + jitter);
  state.pollBackoffMs = Math.min(MAX_POLL_MS, state.pollBackoffMs * 2);
  return delay;
}
