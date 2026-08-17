export type SharedBufferRuntime = {
  readonly create: (byteLength: number) => SharedArrayBuffer;
  readonly byteLength: (value: unknown) => number;
  readonly growable?: (value: SharedArrayBuffer) => boolean;
  readonly maxByteLength?: (value: SharedArrayBuffer) => number;
};
