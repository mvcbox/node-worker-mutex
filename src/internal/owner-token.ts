import { assertThreadId } from './assert-thread-id';

export function ownerToken(threadId: number): number {
  assertThreadId(threadId, false);
  return threadId + 1;
}
