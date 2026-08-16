import type { PollTask } from './PollTask';
import { comparePollTasks } from './compare-poll-tasks';
import { swapPollTasks } from './swap-poll-tasks';

export function bubblePollTaskDown(heap: PollTask[], start: number): void {
  let index = start;

  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;

    if (left < heap.length && comparePollTasks(heap[left], heap[smallest]) < 0) {
      smallest = left;
    }

    if (right < heap.length && comparePollTasks(heap[right], heap[smallest]) < 0) {
      smallest = right;
    }

    if (smallest === index) {
      return;
    }

    swapPollTasks(heap, index, smallest);
    index = smallest;
  }
}
