import type { LocalMutexState } from './LocalMutexState';
import type { PollTask } from './PollTask';
import { getIsolateRegistry } from './get-isolate-registry';
import { pushPollTask } from './push-poll-task';
import { removePollTask } from './remove-poll-task';
import { schedulePollTimer } from './schedule-poll-timer';
import { pollDelay } from './poll-delay';
import { captureTimers } from './capture-timers';
import { MAX_RECURSION_COUNT } from './mutex-constants';

export function awaitPoll(state: LocalMutexState, delayMs?: number): Promise<void> {
  const reg = getIsolateRegistry();
  const existing = reg.pollIndex.get(state.id);

  if (existing) {
    return existing.promise;
  }

  let resolveTask: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolveTask = resolve;
  });
  const delay = delayMs === undefined ? pollDelay(state) : Math.max(0, delayMs);
  const task: PollTask = {
    key: state.id,
    sequence: reg.nextPollSequence,
    promise,
    resolve: resolveTask,
    deadline: Math.ceil(captureTimers().now() + delay),
    heapIndex: -1
  };
  reg.nextPollSequence = reg.nextPollSequence >= MAX_RECURSION_COUNT
    ? 0
    : reg.nextPollSequence + 1;
  pushPollTask(reg, task);

  try {
    schedulePollTimer(reg);
  } catch (cause) {
    removePollTask(reg, task);
    throw cause;
  }

  return promise;
}
