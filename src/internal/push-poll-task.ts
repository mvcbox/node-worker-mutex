import type { PollTask } from './PollTask';
import type { IsolateRegistry } from './IsolateRegistry';
import { bubblePollTaskUp } from './bubble-poll-task-up';

export function pushPollTask(reg: IsolateRegistry, task: PollTask): void {
  task.heapIndex = reg.pollHeap.length;
  reg.pollHeap.push(task);
  bubblePollTaskUp(reg.pollHeap, task.heapIndex);
  reg.pollIndex.set(task.key, task);
}
