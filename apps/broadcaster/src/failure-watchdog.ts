import type { BridgeRecovery } from "./recovery-policy";

type Schedule = (callback: () => void, delayMs: number) => () => void;

const scheduleTimeout: Schedule = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  timer.unref();
  return () => clearTimeout(timer);
};

/** Startup and session/media failures replace the supervised worker. Planner retries do not. */
export function createFailureWatchdog({ manual, onExpire, delayMs = 10_000, schedule = scheduleTimeout }: {
  manual: boolean;
  onExpire: () => void;
  delayMs?: number;
  schedule?: Schedule;
}) {
  let cancel: (() => void) | null = null;
  const clear = () => { cancel?.(); cancel = null; };
  return {
    clear,
    update(status: "starting" | "live" | "degraded", recovery: BridgeRecovery = "restart") {
      if (status !== "degraded") { clear(); return; }
      // A retry report cannot cancel or extend an already pending terminal failure.
      if (manual || recovery === "retrying" || cancel) return;
      cancel = schedule(() => { cancel = null; onExpire(); }, delayMs);
    },
  };
}
