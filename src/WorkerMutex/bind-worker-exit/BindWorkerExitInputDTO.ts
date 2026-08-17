import type { Worker } from 'worker_threads';

export type BindWorkerExitInputDTO = {
  readonly worker: Worker;
  readonly sharedBuffer: SharedArrayBuffer;
};
