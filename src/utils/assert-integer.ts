import { WorkerMutexError } from '../errors';

export function assertInteger(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new WorkerMutexError('VALUE_MUST_BE_AN_INTEGER');
  }
}
