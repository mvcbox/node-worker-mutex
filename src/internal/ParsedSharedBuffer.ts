import type { WorkerMutexModeEnum } from '../WorkerMutexModeEnum';
import type { AtomicsAdapter } from './AtomicsAdapter';

export type ParsedSharedBuffer = {
  readonly i32: Int32Array;
  readonly id: string;
  readonly mode: WorkerMutexModeEnum;
  readonly atomics: AtomicsAdapter;
};
