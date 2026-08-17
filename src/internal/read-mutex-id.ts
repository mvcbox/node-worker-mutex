import type { AtomicsAdapter } from './AtomicsAdapter';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { ID_OFFSET, ID_WORDS } from './mutex-constants';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function readMutexId(i32: Int32Array, atomics: AtomicsAdapter): string {
  const words: string[] = [];
  let nonzero = false;

  for (let index = 0; index < ID_WORDS; index += 1) {
    const value = atomics.load(i32, ID_OFFSET + index);
    words.push((value >>> 0).toString(16).padStart(8, '0'));
    nonzero = nonzero || value !== 0;
  }

  if (!nonzero) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_BUFFER_ID_IS_INVALID);
  }

  return words.join('');
}
