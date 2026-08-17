import type { WorkerMutexModeEnum } from '../../WorkerMutexModeEnum';

export type CreateSharedBufferInputDTO = {
  readonly mode: WorkerMutexModeEnum;
};
