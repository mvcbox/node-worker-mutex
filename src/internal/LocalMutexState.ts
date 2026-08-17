import type { WorkerMutexModeEnum } from '../WorkerMutexModeEnum';
import type { AsyncRequest } from './AsyncRequest';

export type LocalMutexState = {
  readonly id: string;
  readonly mode: WorkerMutexModeEnum;
  blockingDepth: number;
  blockingOwner: number;
  asyncQueue: Array<AsyncRequest | undefined>;
  asyncHead: number;
  asyncRunnerActive: boolean;
  activeLeaseId: number;
  nextLeaseId: number;
  pollBackoffMs: number;
  pollJitterState: number;
};
