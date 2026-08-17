export type TimerRuntime = {
  readonly setTimeout: (callback: () => void, delay: number) => any;
  readonly clearTimeout: (handle: any) => void;
  readonly now: () => number;
};
