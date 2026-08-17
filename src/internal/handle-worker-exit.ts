import type { IsolateRegistry } from './IsolateRegistry';
import type { WorkerBinding } from './WorkerBinding';
import type { WorkerRuntime } from './WorkerRuntime';
import { cleanAbandonedBuffer } from './clean-abandoned-buffer';

const mapForEach = Map.prototype.forEach;

export function handleWorkerExit(
  worker: object,
  runtime: WorkerRuntime,
  registry: IsolateRegistry,
  binding: WorkerBinding
): void {
  try {
    if (runtime.getWorkerThreadId(worker) !== -1) {
      return;
    }

    if (!binding.active || registry.workers.get(worker) !== binding) {
      return;
    }

    binding.active = false;

    try {
      mapForEach.call(binding.buffers, (bound): void => {
        try {
          cleanAbandonedBuffer(bound, binding.ownerToken);
        } catch (_cause) {
          // One malformed handle must not prevent cleanup of the remaining mutexes.
        }
      });
    } catch (_cause) {
      // Bookkeeping below remains best-effort after cleanup iteration fails.
    }

    try {
      binding.buffers.clear();
    } catch (_cause) {}

    try {
      if (registry.workers.get(worker) === binding) {
        registry.workers.delete(worker);
      }
    } catch (_cause) {}

    try {
      runtime.removeExitListener(worker, binding.listener);
    } catch (_cause) {}
  } catch (_cause) {
    return;
  }
}
