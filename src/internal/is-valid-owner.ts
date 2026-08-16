import { OWNER_FREE, OWNER_ABANDONING, MAX_RECURSION_COUNT } from './mutex-constants';

export function isValidOwner(owner: number): boolean {
  return owner === OWNER_ABANDONING || (owner >= OWNER_FREE && owner <= MAX_RECURSION_COUNT);
}
