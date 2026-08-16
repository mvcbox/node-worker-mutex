import type { PollTask } from './PollTask';

export function comparePollTasks(left: PollTask, right: PollTask): number {
  return left.deadline === right.deadline
    ? left.sequence - right.sequence
    : left.deadline - right.deadline;
}
