import type { WorkerMutexLease } from '../WorkerMutexLease';

export type AsyncRequest = {
  readonly expectedBuffer: Int32Array;
  readonly createLease: (releaseCallback: () => void) => WorkerMutexLease;
  readonly resolve: (lease: WorkerMutexLease) => void;
  readonly reject: (cause: unknown) => void;
};
