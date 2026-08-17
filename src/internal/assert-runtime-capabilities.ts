import { captureSharedBufferRuntime } from './capture-shared-buffer-runtime';
import { captureAtomics } from './capture-atomics';
import { captureWorkerRuntime } from './capture-worker-runtime';
import { captureTimers } from './capture-timers';

export function assertRuntimeCapabilities(): void {
  captureSharedBufferRuntime();
  captureAtomics();
  captureWorkerRuntime();
  captureTimers();
}
