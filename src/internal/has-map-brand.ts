import { MAP_BRAND_PROBE } from './mutex-constants';

export function hasMapBrand(value: unknown): boolean {
  try {
    Map.prototype.has.call(value, MAP_BRAND_PROBE);
    return true;
  } catch (_cause) {
    return false;
  }
}
