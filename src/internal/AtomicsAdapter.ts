import type { AsyncWaitResult } from './AsyncWaitResult';

export type AtomicsAdapter = {
  readonly load: (array: Int32Array, index: number) => number;
  readonly store: (array: Int32Array, index: number, value: number) => number;
  readonly add: (array: Int32Array, index: number, value: number) => number;
  readonly compareExchange: (
    array: Int32Array,
    index: number,
    expected: number,
    replacement: number
  ) => number;
  readonly wait: (array: Int32Array, index: number, value: number, timeout?: number) => string;
  readonly wake: (array: Int32Array, index: number, count?: number) => number;
  readonly waitAsync?: (
    array: Int32Array,
    index: number,
    value: number,
    timeout?: number
  ) => AsyncWaitResult;
  waitAsyncUsable: boolean;
};
