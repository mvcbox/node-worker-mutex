import type { AtomicsAdapter } from './AtomicsAdapter';

export type BoundBuffer = {
  readonly i32: Int32Array;
  readonly atomics: AtomicsAdapter;
  references: number;
};
