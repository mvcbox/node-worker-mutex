import type { PollTask } from './PollTask';
import type { IsolateRegistry } from './IsolateRegistry';
import { bubblePollTaskDown } from './bubble-poll-task-down';

export function popPollTask(reg: IsolateRegistry): PollTask | undefined {
  if (reg.pollHeap.length === 0) {
    return undefined;
  }

  const first = reg.pollHeap[0];
  const last = reg.pollHeap.pop() as PollTask;

  if (reg.pollHeap.length > 0) {
    reg.pollHeap[0] = last;
    last.heapIndex = 0;
    bubblePollTaskDown(reg.pollHeap, 0);
  }

  first.heapIndex = -1;
  reg.pollIndex.delete(first.key);
  return first;
}
