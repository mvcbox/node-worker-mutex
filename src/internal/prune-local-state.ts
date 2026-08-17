import type { LocalMutexState } from './LocalMutexState';
import { getIsolateRegistry } from './get-isolate-registry';
import { queuedRequestCount } from './queued-request-count';

export function pruneLocalState(state: LocalMutexState): void {
  const reg = getIsolateRegistry();

  if (
    state.blockingDepth !== 0 ||
    state.activeLeaseId !== 0 ||
    state.asyncRunnerActive ||
    queuedRequestCount(state) !== 0 ||
    reg.pollIndex.has(state.id)
  ) {
    return;
  }

  if (reg.mutexes.get(state.id) === state) {
    reg.mutexes.delete(state.id);
  }
}
