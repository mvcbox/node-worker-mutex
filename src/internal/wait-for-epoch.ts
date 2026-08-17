import type { AtomicsAdapter } from './AtomicsAdapter';
import type { LocalMutexState } from './LocalMutexState';
import { awaitPoll } from './await-poll';
import { getIsolateRegistry } from './get-isolate-registry';
import { isWaitResult } from './is-wait-result';
import { removePollTask } from './remove-poll-task';
import { WAKE_EPOCH_OFFSET, WAIT_WATCHDOG_MS } from './mutex-constants';

export async function waitForEpoch(
  state: LocalMutexState,
  i32: Int32Array,
  epoch: number,
  atomics: AtomicsAdapter
): Promise<void> {
  if (atomics.waitAsync && atomics.waitAsyncUsable) {
    try {
      const result = atomics.waitAsync(i32, WAKE_EPOCH_OFFSET, epoch, WAIT_WATCHDOG_MS);

      if (!isWaitResult(result)) {
        atomics.waitAsyncUsable = false;
      } else {
        if (result.async) {
          const watchdogMarker = {};
          const invalidMarker = {};
          const registry = getIsolateRegistry();
          const watchdog = awaitPoll(state, WAIT_WATCHDOG_MS);
          const watchdogTask = registry.pollIndex.get(state.id);
          const native = Promise.resolve(result.value).then(
            (value) => value,
            () => invalidMarker
          );
          let outcome: string | object;

          try {
            outcome = await Promise.race([
              native,
              watchdog.then(() => watchdogMarker)
            ]);
          } finally {
            if (watchdogTask && registry.pollIndex.get(state.id) === watchdogTask) {
              removePollTask(registry, watchdogTask);
              watchdogTask.resolve();
            }
          }

          if (outcome === watchdogMarker) {
            atomics.waitAsyncUsable = false;
            return;
          }

          if (
            outcome === invalidMarker ||
            (outcome !== 'ok' && outcome !== 'not-equal' && outcome !== 'timed-out')
          ) {
            atomics.waitAsyncUsable = false;
            await awaitPoll(state);
          }
        }

        return;
      }
    } catch (_cause) {
      atomics.waitAsyncUsable = false;
    }
  }

  await awaitPoll(state);
}
