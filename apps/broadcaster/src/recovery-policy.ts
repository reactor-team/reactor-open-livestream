export type BridgeRecovery = "retrying" | "restart";

/** Failed plans keep their scene and native chain, with a bounded request rate. */
export function plannerRetryDelay(failures: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.min(4, Math.max(0, failures - 1)));
}
