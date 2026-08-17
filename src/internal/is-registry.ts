import type { IsolateRegistry } from './IsolateRegistry';
import { hasMapBrand } from './has-map-brand';
import { hasWeakMapBrand } from './has-weak-map-brand';
import { isValidTimerHandle } from './is-valid-timer-handle';
import { isValidKeeperTimer } from './is-valid-keeper-timer';
import { REGISTRY_ABI_VERSION } from './mutex-constants';

export function isRegistry(value: unknown): value is IsolateRegistry {
  try {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as IsolateRegistry;
    return (
      candidate.abiVersion === REGISTRY_ABI_VERSION &&
      hasMapBrand(candidate.mutexes) &&
      hasWeakMapBrand(candidate.workers) &&
      Array.isArray(candidate.pollHeap) &&
      hasMapBrand(candidate.pollIndex) &&
      Number.isInteger(candidate.pendingAsyncRequests) &&
      candidate.pendingAsyncRequests >= 0 &&
      Number.isInteger(candidate.nextPollSequence) &&
      candidate.nextPollSequence >= 0 &&
      Number.isFinite(candidate.pollTimerDeadline) &&
      Number.isInteger(candidate.pollTimerToken) &&
      candidate.pollTimerToken >= 0 &&
      isValidKeeperTimer(candidate.keeperTimer) &&
      isValidTimerHandle(candidate.pollTimer)
    );
  } catch (_cause) {
    return false;
  }
}
