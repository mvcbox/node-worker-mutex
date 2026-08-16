import type { ParsedSharedBuffer } from './ParsedSharedBuffer';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { captureAtomics } from './capture-atomics';
import { assertRuntimeCapabilities } from './assert-runtime-capabilities';
import { sharedBufferByteLength } from './shared-buffer-byte-length';
import { assertNotGrowable } from './assert-not-growable';
import { modeFromCell } from './mode-from-cell';
import { readMutexId } from './read-mutex-id';
import { isValidOwner } from './is-valid-owner';
import { MAGIC, VERSION, MAGIC_OFFSET, VERSION_OFFSET, MODE_OFFSET, OWNER_OFFSET, RECURSION_OFFSET, BYTES_PER_MUTEX } from './mutex-constants';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function parseSharedBuffer(value: unknown): ParsedSharedBuffer {
  assertRuntimeCapabilities();
  const byteLength = sharedBufferByteLength(value);

  if (byteLength === 3 * Int32Array.BYTES_PER_ELEMENT) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_BUFFER_LAYOUT_IS_NOT_SUPPORTED);
  }

  if (byteLength !== BYTES_PER_MUTEX) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_BUFFER_SIZE_MUST_MATCH_SINGLE_MUTEX);
  }

  const buffer = value as SharedArrayBuffer;
  assertNotGrowable(buffer);
  const i32 = new Int32Array(buffer);
  const atomics = captureAtomics();

  if (atomics.load(i32, MAGIC_OFFSET) !== MAGIC || atomics.load(i32, VERSION_OFFSET) !== VERSION) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_BUFFER_LAYOUT_IS_NOT_SUPPORTED);
  }

  const mode = modeFromCell(atomics.load(i32, MODE_OFFSET));
  const id = readMutexId(i32, atomics);

  if (!isValidOwner(atomics.load(i32, OWNER_OFFSET))) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_STATE_IS_CORRUPTED);
  }

  if (atomics.load(i32, RECURSION_OFFSET) < 0) {
    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_STATE_IS_CORRUPTED);
  }

  return { i32, id, mode, atomics };
}
