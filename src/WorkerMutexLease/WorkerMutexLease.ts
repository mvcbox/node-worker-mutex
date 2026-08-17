import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import '../internal/ensure-symbol-dispose';
import { workerMutexLeaseConstructionToken } from '../internal/worker-mutex-lease-construction-token';

export class WorkerMutexLease {
  private active: boolean;
  private releaseCallback: (() => void) | undefined;

  private constructor(releaseCallback: () => void, token: object) {
    if (
      token !== workerMutexLeaseConstructionToken ||
      typeof releaseCallback !== 'function'
    ) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_LEASE_CONSTRUCTION_NOT_ALLOWED);
    }

    this.active = true;
    this.releaseCallback = releaseCallback;
  }

  public get released(): boolean {
    return !this.active;
  }

  public release(): void {
    const releaseCallback = this.releaseCallback;

    if (!this.active || !releaseCallback) {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.MUTEX_LEASE_IS_NOT_ACTIVE);
    }

    releaseCallback();
    this.active = false;
    this.releaseCallback = undefined;
  }

  public [Symbol.dispose](): void {
    if (this.active) {
      this.release();
    }
  }
}
