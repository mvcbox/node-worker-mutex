import type { KeeperTimer } from './KeeperTimer';

export function isValidKeeperTimer(value: unknown): boolean {
  try {
    return value === undefined || (
      value !== null &&
      typeof value === 'object' &&
      'handle' in (value as object) &&
      typeof (value as KeeperTimer).ref === 'function' &&
      typeof (value as KeeperTimer).unref === 'function' &&
      typeof (value as KeeperTimer).refresh === 'function'
    );
  } catch (_cause) {
    return false;
  }
}
