import type { AsyncWaitResult } from './AsyncWaitResult';

export function isWaitResult(value: unknown): value is AsyncWaitResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const result = value as AsyncWaitResult;

  if (typeof result.async !== 'boolean') {
    return false;
  }

  if (result.async) {
    return !!result.value && typeof (result.value as any).then === 'function';
  }

  return (
    result.value === 'ok' ||
    result.value === 'not-equal' ||
    result.value === 'timed-out'
  );
}
