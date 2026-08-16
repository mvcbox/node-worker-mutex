export type AsyncWaitResult = {
  readonly async: boolean;
  readonly value: string | PromiseLike<string>;
};
