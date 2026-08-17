import type { PollTask } from './PollTask';
import type { IsolateRegistry } from './IsolateRegistry';
import { WorkerMutexError } from '../errors/WorkerMutexError';
import { captureTimers } from './capture-timers';
import { popPollTask } from './pop-poll-task';
import { nextPollTimerToken } from './next-poll-timer-token';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function schedulePollTimer(reg: IsolateRegistry): void {
  const timers = captureTimers();
  const first = reg.pollHeap[0];

  if (!first) {
    return;
  }

  if (reg.pollTimer !== undefined && reg.pollTimerDeadline <= first.deadline) {
    return;
  }

  const delay = Math.ceil(Math.max(0, first.deadline - timers.now()));
  const token = nextPollTimerToken(reg.pollTimerToken);
  const previousTimer = reg.pollTimer;
  let replacementTimer: any;
  try {
    const handle = timers.setTimeout(() => {
      if (reg.pollTimerToken !== token) {
        return;
      }

      reg.pollTimer = undefined;
      reg.pollTimerDeadline = 0;
      const now = timers.now();
      const ready: PollTask[] = [];

      while (reg.pollHeap.length > 0 && reg.pollHeap[0].deadline <= now) {
        const task = popPollTask(reg);

        if (task) {
          ready.push(task);
        }
      }

      schedulePollTimer(reg);

      for (let index = 0; index < ready.length; index += 1) {
        ready[index].resolve();
      }
    }, delay);
    replacementTimer = handle;

    if (!handle || typeof handle.unref !== 'function') {
      try {
        timers.clearTimeout(handle);
      } catch (_cause) {
        // The typed capability error below is the public failure contract.
      }

      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE);
    }

    handle.unref();

    if (previousTimer !== undefined) {
      try {
        timers.clearTimeout(previousTimer);
      } catch (_cause) {
        try {
          timers.clearTimeout(handle);
        } catch (_newTimerCause) {
          // The token check keeps an uncancelled replacement inert.
        }

        throw new WorkerMutexError(WorkerMutexErrorCodeEnum.REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE);
      }
    }

    reg.pollTimerToken = token;
    reg.pollTimer = handle;
    reg.pollTimerDeadline = first.deadline;
    replacementTimer = undefined;
  } catch (cause) {
    if (replacementTimer !== undefined) {
      try {
        timers.clearTimeout(replacementTimer);
      } catch (_clearCause) {
        // Its token is not published, so a surviving callback is inert.
      }
    }

    if (cause instanceof WorkerMutexError) {
      throw cause;
    }

    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.REQUIRED_TIMER_OPERATIONS_ARE_NOT_AVAILABLE);
  }
}
