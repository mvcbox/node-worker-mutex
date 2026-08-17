export type PollTask = {
  readonly key: string;
  readonly sequence: number;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  deadline: number;
  heapIndex: number;
};
