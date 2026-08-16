import type { PollTask } from './PollTask';
import type { IsolateRegistry } from './IsolateRegistry';
import { comparePollTasks } from './compare-poll-tasks';
import { bubblePollTaskUp } from './bubble-poll-task-up';
import { bubblePollTaskDown } from './bubble-poll-task-down';

export function removePollTask(reg: IsolateRegistry, task: PollTask): void {
  const index = task.heapIndex;

  if (
    index < 0 ||
    index >= reg.pollHeap.length ||
    reg.pollHeap[index] !== task
  ) {
    return;
  }

  const last = reg.pollHeap.pop() as PollTask;

  if (index < reg.pollHeap.length) {
    reg.pollHeap[index] = last;
    last.heapIndex = index;

    if (
      index > 0 &&
      comparePollTasks(reg.pollHeap[index], reg.pollHeap[Math.floor((index - 1) / 2)]) < 0
    ) {
      bubblePollTaskUp(reg.pollHeap, index);
    } else {
      bubblePollTaskDown(reg.pollHeap, index);
    }
  }

  task.heapIndex = -1;

  if (reg.pollIndex.get(task.key) === task) {
    reg.pollIndex.delete(task.key);
  }
}
