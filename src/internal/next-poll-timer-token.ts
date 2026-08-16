import { MAX_RECURSION_COUNT } from './mutex-constants';

export function nextPollTimerToken(current: number): number {
  return current >= MAX_RECURSION_COUNT ? 0 : current + 1;
}
