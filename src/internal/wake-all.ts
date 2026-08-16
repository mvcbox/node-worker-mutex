import type { AtomicsAdapter } from './AtomicsAdapter';
import { WAKE_EPOCH_OFFSET, MAX_RECURSION_COUNT } from './mutex-constants';

export function wakeAll(i32: Int32Array, atomics: AtomicsAdapter, bestEffort: boolean): void {
  try {
    atomics.add(i32, WAKE_EPOCH_OFFSET, 1);
    atomics.wake(i32, WAKE_EPOCH_OFFSET, MAX_RECURSION_COUNT);
  } catch (cause) {
    if (!bestEffort) {
      throw cause;
    }
  }
}
