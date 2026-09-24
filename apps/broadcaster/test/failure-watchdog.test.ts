import assert from "node:assert/strict";
import test from "node:test";
import { createFailureWatchdog } from "../src/failure-watchdog";
import { plannerRetryDelay } from "../src/recovery-policy";

function fixture(manual = false) {
  let now = 0, exits = 0;
  const timers = new Set<{ callback: () => void; at: number }>();
  const watchdog = createFailureWatchdog({ manual, onExpire: () => exits++, schedule(callback, delay) {
    const timer = { callback, at: now + delay }; timers.add(timer);
    return () => { timers.delete(timer); };
  } });
  return { watchdog, exits: () => exits, tick(ms: number) {
    now += ms;
    for (const timer of timers) if (timer.at <= now) { timers.delete(timer); timer.callback(); }
  } };
}

test("recoverable planning can exceed ten seconds and recover without a process restart", () => {
  const f = fixture();
  for (let failures = 1; failures <= 10; failures++) {
    f.watchdog.update("degraded", "retrying");
    f.tick(plannerRetryDelay(failures) + 10_000);
  }
  assert.equal(f.exits(), 0);
  f.watchdog.update("live"); f.tick(60_000);
  assert.equal(f.exits(), 0);
});

test("terminal failures retain their original deadline despite retries and repeated failures", () => {
  const f = fixture();
  f.watchdog.update("degraded"); f.tick(5000);
  f.watchdog.update("degraded", "retrying");
  f.watchdog.update("degraded", "restart"); f.tick(4999);
  assert.equal(f.exits(), 0); f.tick(1); assert.equal(f.exits(), 1);
  f.tick(60_000); assert.equal(f.exits(), 1);
});

test("recovery, manual stop and manual mode prevent a stale shutdown", () => {
  for (const state of ["starting", "live"] as const) {
    const f = fixture(); f.watchdog.update("degraded"); f.tick(5000);
    f.watchdog.update(state); f.tick(60_000); assert.equal(f.exits(), 0);
  }
  const stopped = fixture(); stopped.watchdog.update("degraded"); stopped.watchdog.clear(); stopped.tick(60_000);
  assert.equal(stopped.exits(), 0);
  const manual = fixture(true); manual.watchdog.update("degraded"); manual.tick(60_000); assert.equal(manual.exits(), 0);
});

test("planner retry backoff is bounded even during a long provider outage", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 1000].map(plannerRetryDelay), [2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});
