import { MAP_BRAND_PROBE } from './mutex-constants';

export function hasWeakMapBrand(value: unknown): boolean {
  try {
    WeakMap.prototype.has.call(value, MAP_BRAND_PROBE);
    return true;
  } catch (_cause) {
    return false;
  }
}
