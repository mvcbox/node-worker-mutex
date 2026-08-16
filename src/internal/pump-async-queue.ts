import type { AtomicsAdapter } from './AtomicsAdapter';
import type { LocalMutexState } from './LocalMutexState';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { captureAtomics } from './capture-atomics';
import { getIsolateRegistry } from './get-isolate-registry';
import { queuedRequestCount } from './queued-request-count';
import { takeQueueHead } from './take-queue-head';
import { pruneLocalState } from './prune-local-state';
import { releasePendingAsync } from './release-pending-async';
import { rollbackExactOwner } from './rollback-exact-owner';
import { acquireAsyncOwner } from './acquire-async-owner';
import { releaseAsyncLease } from './release-async-lease';
import { MAX_RECURSION_COUNT } from './mutex-constants';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function pumpAsyncQueue(state: LocalMutexState): void {
  if (state.asyncRunnerActive || state.activeLeaseId !== 0 || queuedRequestCount(state) === 0) {
    return;
  }

  state.asyncRunnerActive = true;

  const run = async (): Promise<void> => {
    const reg = getIsolateRegistry();

    while (state.activeLeaseId === 0 && queuedRequestCount(state) > 0) {
      const request = state.asyncQueue[state.asyncHead];

      if (request === undefined) {
        throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_LOCAL_STATE_IS_INCONSISTENT);
      }

      const expectedBuffer = request.expectedBuffer;
      const createLease = request.createLease;
      let atomics: AtomicsAdapter | undefined;
      let token: number | undefined;
      let dequeued = false;
      let accountingAttempted = false;

      try {
        atomics = captureAtomics();
        token = await acquireAsyncOwner(state, expectedBuffer, atomics);

        if (takeQueueHead(state) !== request) {
          throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_LOCAL_STATE_IS_INCONSISTENT);
        }

        dequeued = true;
        accountingAttempted = true;
        releasePendingAsync(reg);
        const leaseId = state.nextLeaseId;
        const lease = createLease(() => {
          releaseAsyncLease(
            state,
            expectedBuffer,
            atomics as AtomicsAdapter,
            leaseId,
            token as number
          );
          pumpAsyncQueue(state);
          pruneLocalState(state);
        });
        state.nextLeaseId = leaseId >= MAX_RECURSION_COUNT ? 1 : leaseId + 1;
        state.activeLeaseId = leaseId;
        state.asyncRunnerActive = false;
        request.resolve(lease);
        return;
      } catch (cause) {
        // Dequeue/accounting happen once; an unpublished lease returns its exact owner first.
        if (token !== undefined && atomics !== undefined) {
          rollbackExactOwner(expectedBuffer, atomics, token);
        }

        if (!dequeued && state.asyncQueue[state.asyncHead] === request) {
          takeQueueHead(state);
          dequeued = true;
        }

        if (dequeued && !accountingAttempted) {
          accountingAttempted = true;

          try {
            releasePendingAsync(reg);
          } catch (_accountingCause) {
            // The original request failure remains the rejection reason.
          }
        }

        request.reject(cause);
      }
    }

    state.asyncRunnerActive = false;
    pruneLocalState(state);
  };

  run().catch(() => {
    state.asyncRunnerActive = false;
    pruneLocalState(state);
  });
}
