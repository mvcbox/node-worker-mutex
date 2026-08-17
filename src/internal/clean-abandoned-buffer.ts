import type { BoundBuffer } from './BoundBuffer';
import { wakeAll } from './wake-all';
import { OWNER_OFFSET, RECURSION_OFFSET, OWNER_FREE, OWNER_ABANDONING } from './mutex-constants';

export function cleanAbandonedBuffer(bound: BoundBuffer, expectedOwner: number): void {
  const atomics = bound.atomics;
  const i32 = bound.i32;
  let claimed = false;

  try {
    claimed = (
      atomics.compareExchange(i32, OWNER_OFFSET, expectedOwner, OWNER_ABANDONING) === expectedOwner
    );
  } catch (_cause) {
    return;
  }

  if (!claimed) {
    return;
  }

  // Only the exact T -> ABANDONING claimant may publish FREE for this owner.
  try {
    atomics.store(i32, RECURSION_OFFSET, 0);
  } catch (_cause) {
    return;
  } finally {
    try {
      if (
        atomics.compareExchange(i32, OWNER_OFFSET, OWNER_ABANDONING, OWNER_FREE) ===
        OWNER_ABANDONING
      ) {
        wakeAll(i32, atomics, true);
      }
    } catch (_cause) {
      return;
    }
  }
}
