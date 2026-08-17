import { WorkerMutexLease } from '../WorkerMutexLease';
import { workerMutexLeaseConstructionToken } from './worker-mutex-lease-construction-token';

export function createWorkerMutexLease(releaseCallback: () => void): WorkerMutexLease {
  const LeaseConstructor = WorkerMutexLease as unknown as {
    new (callback: () => void, token: object): WorkerMutexLease;
  };
  return new LeaseConstructor(
    releaseCallback,
    workerMutexLeaseConstructionToken
  ) as WorkerMutexLease;
}
