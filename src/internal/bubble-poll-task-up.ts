import type { PollTask } from './PollTask';
import { comparePollTasks } from './compare-poll-tasks';
import { swapPollTasks } from './swap-poll-tasks';

export function bubblePollTaskUp(heap: PollTask[], start: number): void {
  let index = start;

  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);

    if (comparePollTasks(heap[parent], heap[index]) <= 0) {
      return;
    }

    swapPollTasks(heap, parent, index);
    index = parent;
  }
}
