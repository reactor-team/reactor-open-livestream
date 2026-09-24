type IdleLeaseOptions = {
  timeoutMs: number;
  onExpire: () => void | Promise<void>;
  onError?: (error: unknown) => void;
};

export function createIdleLease(options: IdleLeaseOptions) {
  let timer: NodeJS.Timeout | undefined;

  const clear = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const renew = () => {
    clear();
    timer = setTimeout(() => {
      timer = undefined;
      void Promise.resolve(options.onExpire()).catch(options.onError);
    }, options.timeoutMs);
    timer.unref();
  };

  return { clear, renew };
}
