import type { KeeperTimer } from './KeeperTimer';
import type { LocalMutexState } from './LocalMutexState';
import type { PollTask } from './PollTask';
import type { WorkerBinding } from './WorkerBinding';

export type IsolateRegistry = {
  readonly abiVersion: number;
  readonly mutexes: Map<string, LocalMutexState>;
  readonly workers: WeakMap<object, WorkerBinding>;
  readonly pollHeap: PollTask[];
  readonly pollIndex: Map<string, PollTask>;
  pendingAsyncRequests: number;
  keeperTimer: KeeperTimer | undefined;
  pollTimer: any;
  pollTimerDeadline: number;
  pollTimerToken: number;
  nextPollSequence: number;
};
