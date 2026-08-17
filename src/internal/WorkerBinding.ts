import type { BoundBuffer } from './BoundBuffer';

export type WorkerBinding = {
  readonly workerId: number;
  readonly ownerToken: number;
  readonly listener: (exitCode: number) => void;
  readonly buffers: Map<SharedArrayBuffer, BoundBuffer>;
  active: boolean;
};
