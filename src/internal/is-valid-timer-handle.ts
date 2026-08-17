export function isValidTimerHandle(value: unknown): boolean {
  return value === undefined || (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as any).ref === 'function' &&
    typeof (value as any).unref === 'function'
  );
}
