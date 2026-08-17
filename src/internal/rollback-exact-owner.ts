import type { AtomicsAdapter } from './AtomicsAdapter';
import { wakeAll } from './wake-all';
import { OWNER_OFFSET, RECURSION_OFFSET, OWNER_FREE } from './mutex-constants';

export function rollbackExactOwner(
  i32: Int32Array,
  atomics: AtomicsAdapter,
  token: number
): void {
  try {
    atomics.store(i32, RECURSION_OFFSET, 0);
  } catch (_cause) {
    // The exact owner word remains authoritative if recursion reset fails.
  }

  try {
    if (atomics.compareExchange(i32, OWNER_OFFSET, token, OWNER_FREE) === token) {
      wakeAll(i32, atomics, true);
    }
  } catch (_cause) {
    return;
  }
}
