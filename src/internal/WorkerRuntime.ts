export type WorkerRuntime = {
  readonly isMainThread: boolean;
  readonly threadId: number;
  readonly getWorkerThreadId: (worker: object) => number;
  readonly prependExitListener: (worker: object, listener: (exitCode: number) => void) => void;
  readonly removeExitListener: (worker: object, listener: (exitCode: number) => void) => void;
};
