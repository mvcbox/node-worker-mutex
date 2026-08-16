export type KeeperTimer = {
  readonly handle: any;
  readonly ref: () => void;
  readonly unref: () => void;
  readonly refresh: () => void;
};
