import type { PollTask } from './PollTask';

export function swapPollTasks(heap: PollTask[], leftIndex: number, rightIndex: number): void {
  const left = heap[leftIndex];
  heap[leftIndex] = heap[rightIndex];
  heap[rightIndex] = left;
  heap[leftIndex].heapIndex = leftIndex;
  heap[rightIndex].heapIndex = rightIndex;
}
