import type { AtomicsAdapter } from './AtomicsAdapter';
import type { LocalMutexState } from './LocalMutexState';
import { captureWorkerRuntime } from './capture-worker-runtime';
import { ownerToken } from './owner-token';
import { waitForEpoch } from './wait-for-epoch';
import { tryAcquireOwner } from './try-acquire-owner';
import { WAKE_EPOCH_OFFSET } from './mutex-constants';

export async function acquireAsyncOwner(
  state: LocalMutexState,
  i32: Int32Array,
  atomics: AtomicsAdapter
): Promise<number> {
  const token = ownerToken(captureWorkerRuntime().threadId);

  while (true) {
    if (tryAcquireOwner(state, i32, atomics, token)) {
      return token;
    }

    const epoch = atomics.load(i32, WAKE_EPOCH_OFFSET);

    // The second CAS closes the release-before-wait window after the epoch snapshot.
    if (tryAcquireOwner(state, i32, atomics, token)) {
      return token;
    }

    await waitForEpoch(state, i32, epoch, atomics);
  }
}
