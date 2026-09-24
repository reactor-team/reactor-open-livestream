type Child = {
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  kill(signal: NodeJS.Signals): boolean;
};
type Schedule = (callback: () => void, delayMs: number) => () => void;

const scheduleTimeout: Schedule = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

export function processRestartDelay(failures: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.min(5, Math.max(0, failures - 1)));
}

/** A fresh worker owns each model session. The parent never holds broadcast state. */
export function superviseProcess({
  spawnChild, onStopped, log = console.log, now = Date.now, schedule = scheduleTimeout,
  stableRunMs = 60_000, stopTimeoutMs = 8000,
}: {
  spawnChild: () => Child;
  onStopped: (exitCode: number) => void;
  log?: (message: string) => void;
  now?: () => number;
  schedule?: Schedule;
  stableRunMs?: number;
  stopTimeoutMs?: number;
}) {
  let child: Child | undefined;
  let failures = 0;
  let stopping = false;
  let finished = false;
  let cancelRestart: (() => void) | undefined;
  let cancelStop: (() => void) | undefined;

  const finish = (code: number) => {
    if (finished) return;
    finished = true;
    cancelRestart?.();
    cancelStop?.();
    onStopped(code);
  };
  const retry = (startedAt: number) => {
    if (stopping || finished) return;
    failures = now() - startedAt >= stableRunMs ? 1 : failures + 1;
    const delay = processRestartDelay(failures);
    log(`[process-supervisor] Worker stopped; starting a fresh process in ${delay}ms`);
    cancelRestart = schedule(() => {
      cancelRestart = undefined;
      launch();
    }, delay);
  };
  const launch = () => {
    if (stopping || finished || child) return;
    const startedAt = now();
    let launched: Child;
    try {
      log("[process-supervisor] Starting broadcaster worker");
      launched = spawnChild();
    } catch {
      log("[process-supervisor] Could not start worker");
      retry(startedAt);
      return;
    }
    child = launched;
    launched.once("error", () => {
      // Node emits close after a failed spawn; only close schedules a retry.
      log("[process-supervisor] Worker process error");
    });
    launched.once("close", (_code, signal) => {
      if (child !== launched || finished) return;
      child = undefined;
      if (stopping) { finish(0); return; }
      if (signal) {
        // An unhandled signal can skip Playwright's browser cleanup. Replace the
        // container rather than accumulating orphan publishers in this process.
        log("[process-supervisor] Worker was killed; requesting container recovery");
        finish(1);
        return;
      }
      retry(startedAt);
    });
  };

  const stop = () => {
    if (stopping || finished) return;
    stopping = true;
    cancelRestart?.();
    cancelRestart = undefined;
    if (!child) { finish(0); return; }
    const active = child;
    cancelStop = schedule(() => {
      try { active.kill("SIGKILL"); } catch { /* Container exit completes cleanup. */ }
      finish(0);
    }, stopTimeoutMs);
    try { active.kill("SIGTERM"); } catch { /* The bounded stop deadline remains armed. */ }
  };

  launch();
  return { stop };
}
