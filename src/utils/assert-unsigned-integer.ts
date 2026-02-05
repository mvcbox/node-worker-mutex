import { WorkerMutexError } from '../errors';

export function assertUnsignedInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new WorkerMutexError('VALUE_MUST_BE_AN_UNSIGNED_INTEGER');
  }
}
