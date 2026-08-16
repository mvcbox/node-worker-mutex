export type ProcessWithRegistry = typeof process & { [key: symbol]: unknown };
