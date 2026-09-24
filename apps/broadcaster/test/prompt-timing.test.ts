import assert from "node:assert/strict";
import test from "node:test";
import { promptTimings, type QueueTiming, type TimingPrompt } from "@reactor/infinite-contracts";
import { PromptTimingTracker } from "../src/prompt-timing";
import { clipFromMessageData } from "../src/continuity";
import { updateQueueTiming, heartbeat } from "../../../webapp/convex/broadcast";

const now = 100000;
const prompt: TimingPrompt = { _id: "viewer", status: "pending", createdAt: now };
const full: QueueTiming = {
  observedAt: now,
  clips: [
    { clipId: "a", seconds: 6, enqueuedAt: now - 18000, generatedAt: now - 12000, startedAt: now - 2000 },
    { clipId: "b", seconds: 6, enqueuedAt: now - 12000, generatedAt: now - 6000 },
    { clipId: "c", seconds: 6, enqueuedAt: now - 6000, generationStartedAt: now - 6000 },
  ], generationRates: [1, 1.2], planningSeconds: [2, 3],
};
function labels(timing: QueueTiming | undefined = full, prompts = [prompt], overrides = {}) {
  return promptTimings({ timing, prompts, now, status: "live", chunkSeconds: 6, ...overrides });
}

test("a six-second prompt waits for buffered video, planning and generation", () => {
  assert.equal(labels().get("viewer")?.label, "#1 in queue · about 20s");
  const advanced = { ...full, observedAt: now + 2000 };
  assert.equal(labels(advanced, [prompt], { now: now + 2000 }).get("viewer")?.label, "#1 in queue · about 15s");
});

test("slow generation increases the estimate and later requests wait longer", () => {
  const slow = { ...full, generationRates: [2.5, 3] };
  const prompts = [prompt, { ...prompt, _id: "second", createdAt: now + 1 }];
  assert.equal(labels(slow, prompts).get("viewer")!.label, "#1 in queue · about 30s");
  assert.equal(labels(slow, prompts).get("second")!.label, "#2 in queue · about 50s");
});

test("buffered prompt uses actual clip lengths without needing generation samples", () => {
  const timing: QueueTiming = { ...full, generationRates: [], planningSeconds: [], clips: [
    { ...full.clips[0], seconds: 14.375 },
    { ...full.clips[1], promptId: "viewer" },
  ] };
  const estimate = labels(timing, [{ ...prompt, status: "queued" }]).get("viewer")!;
  assert.equal(estimate.label, "#1 in queue · about 15s");
  assert.match(estimate.title!, /^Buffered\./);
  assert.deepEqual(clipFromMessageData({ clip: { clip_id: "a", seconds: 14.375 } }), { clip_id: "a", seconds: 14.375 });
});

test("compact estimates round short waits without showing zero and update as playback advances", () => {
  const timing: QueueTiming = { ...full, generationRates: [], planningSeconds: [], clips: [
    { ...full.clips[0], seconds: 14.375, startedAt: now - 5875 },
    { ...full.clips[1], promptId: "viewer" },
  ] };
  const prompts = [{ ...prompt, status: "queued" }];
  assert.equal(labels(timing, prompts).get("viewer")?.label, "#1 in queue · about 10s");
  assert.equal(labels(timing, prompts, { now: now + 5000 }).get("viewer")?.label, "#1 in queue · about 5s");
  assert.equal(labels(timing, prompts, { now: now + 8500 }).get("viewer")?.label, "#1 in queue · about 5s");
});

test("longer queues show one rounded minute estimate without ranges or decimal minutes", () => {
  const timing = { ...full, generationRates: [2.5, 3] };
  const prompts = Array.from({ length: 3 }, (_, index) => ({ ...prompt, _id: String(index), createdAt: now + index }));
  assert.equal(labels(timing, prompts).get("2")?.label, "#3 in queue · about 1m 15s");
});

test("claimed prompt and active automatic planning each occupy only one slot", () => {
  const timing = { ...full, clips: full.clips.slice(0, 2), planning: { startedAt: now - 1000, seconds: 6 } };
  const automatic = labels(timing).get("viewer")!.label;
  const ownPlan = labels({ ...timing, planning: { ...timing.planning, promptId: "viewer" } }, [{ ...prompt, status: "queued" }]).get("viewer")!.label;
  assert.equal(automatic, "#1 in queue · about 20s");
  assert.equal(ownPlan, "#1 in queue · about 15s");
});

test("missing, cold, stale, interrupted and stalled pipelines never invent a countdown", () => {
  assert.equal(labels(undefined, [prompt], { timing: undefined }).get("viewer")?.label, "#1 in queue");
  assert.equal(labels({ ...full, generationRates: [] }).get("viewer")?.label, "#1 in queue");
  assert.equal(labels(full, [prompt], { now: now + 25000 }).get("viewer")?.label, "#1 in queue");
  assert.equal(labels(full, [prompt], { now: now - 6000 }).get("viewer")?.label, "#1 in queue");
  assert.equal(labels(full, [{ ...prompt, playNow: true }]).get("viewer")?.label, "#1 in queue");
  assert.equal(labels(full, [prompt], { now: now + 9000 }).get("viewer")?.label, "#1 in queue: taking longer than expected");
  assert.equal(labels(full, [prompt], { status: "degraded" }).get("viewer")?.label, "#1 in queue · Waiting for stream to recover");
  assert.equal(labels(full, [prompt], { status: "offline" }).get("viewer")?.label, "#1 in queue · Queued for next broadcast");
  assert.equal(labels(full, [prompt], { voting: true }).get("viewer")?.label, "#1 in queue · Saved for text mode");
  assert.equal(labels(full, [{ ...prompt, status: "played" }]).get("viewer")?.label, "Aired");
  assert.equal(labels(full, [{ ...prompt, status: "playing" }]).get("viewer")?.label, "Playing now");
});

test("fresh heartbeats cannot conceal a stalled generation or planning call", () => {
  const stalledGeneration = { ...full, observedAt: now + 15000, clips: full.clips.slice(2) };
  assert.equal(labels(stalledGeneration, [prompt], { now: now + 15000 }).get("viewer")?.label, "#1 in queue: taking longer than expected");
  const stalledPlan = { ...full, observedAt: now, clips: [], planning: { promptId: "viewer", seconds: 6, startedAt: now - 10000 } };
  assert.equal(labels(stalledPlan, [{ ...prompt, status: "queued" }]).get("viewer")?.label, "#1 in queue · Preparing prompt: taking longer than expected");
});

test("an unobserved claim prevents optimistic estimates for the requests behind it", () => {
  const prompts = [{ ...prompt, status: "queued" }, { ...prompt, _id: "second", createdAt: now + 1 }];
  assert.equal(labels(full, prompts).get("second")?.label, "#2 in queue");
});

test("telemetry measures serial generation and handles early, duplicate and terminal events", () => {
  let clock = now;
  const tracker = new PromptTimingTracker(() => clock);
  tracker.beginPlanning("viewer", 6);
  clock += 2000; tracker.planned();
  tracker.observe("sent", "trace-a", { seconds: 6, metadata: JSON.stringify({ id: "viewer", text: "private body" }), prompt: "private model prompt" });
  tracker.observe("state", "a", { type: "clip_queued", seconds: 6.375 });
  tracker.observe("accepted", "trace-a", { clip_id: "a", seconds: 6.375 });
  clock += 1000;
  tracker.observe("sent", "trace-b", { seconds: 6, metadata: "{}" });
  tracker.observe("accepted", "trace-b", { clip_id: "b", seconds: 6.375 });
  clock += 5375;
  tracker.observe("state", "a", { type: "clip_generated" });
  tracker.observe("state", "a", { type: "clip_generated" });
  tracker.observe("state", "a", { type: "clip_started" });
  assert.deepEqual(tracker.snapshot().generationRates, [1]);
  assert.equal(tracker.snapshot().clips[1].generationStartedAt, clock);
  clock += 6375;
  tracker.observe("state", "b", { type: "clip_generated" });
  assert.deepEqual(tracker.snapshot().generationRates, [1, 1]);
  assert.deepEqual(tracker.snapshot().planningSeconds, [2]);
  assert.equal(tracker.snapshot().planning, undefined);
  assert.doesNotMatch(JSON.stringify(tracker.snapshot()), /private|metadata|author|trace-/);
  tracker.observe("state", "a", { type: "clip_finished" });
  tracker.observe("state", "b", { type: "clip_popped" });
  assert.equal(tracker.snapshot().clips.length, 0);
  tracker.beginPlanning(null, 6); tracker.planningFailed();
  assert.equal(tracker.snapshot().planning, undefined);
  assert.equal(new PromptTimingTracker().snapshot().generationRates.length, 0);
});

test("a generated event before the enqueue reply is retained with its timestamp", () => {
  let clock = now;
  const tracker = new PromptTimingTracker(() => clock);
  tracker.observe("sent", "trace", { seconds: 6, metadata: "{}" });
  clock += 7000;
  tracker.observe("state", "a", { type: "clip_generated", seconds: 6.375 });
  clock += 100;
  tracker.observe("accepted", "trace", { clip_id: "a", seconds: 6.375 });
  assert.equal(tracker.snapshot().clips[0].generatedAt, now + 7000);
  assert.equal(tracker.snapshot().generationRates.length, 1);
});

test("Convex rejects stale sessions, out-of-order telemetry and unauthorized writers", async () => {
  const secret = "timing-unit-test";
  const previous = process.env.BROADCASTER_SECRET; process.env.BROADCASTER_SECRET = secret;
  try {
    const at = Date.now();
    const row: Record<string, unknown> = { _id: "broadcast", status: "live", startedAt: at };
    let expiryJobs = 0;
    const ctx = {
      db: { query: () => ({ withIndex: () => ({ unique: async () => row }) }), patch: async (_id: string, patch: object) => Object.assign(row, patch) },
      scheduler: { runAfter: async () => { expiryJobs++; } },
    };
    const run = (fn: unknown, args: object) => (fn as { _handler: (ctx: unknown, args: object) => Promise<unknown> })._handler(ctx, { secret, ...args });
    const timing = { ...full, observedAt: at };
    await assert.rejects(run(updateQueueTiming, { secret: "wrong", sessionStartedAt: at, timing }), /Unauthorized/);
    await run(updateQueueTiming, { sessionStartedAt: at - 1, timing });
    assert.equal(row.queueTiming, undefined);
    await run(updateQueueTiming, { sessionStartedAt: at, timing });
    assert.deepEqual(row.queueTiming, timing);
    await run(updateQueueTiming, { sessionStartedAt: at, timing: { ...timing, observedAt: at - 1 } });
    assert.deepEqual(row.queueTiming, timing);
    assert.equal(expiryJobs, 0);
    await run(heartbeat, { status: "live", startedAt: at });
    assert.deepEqual(row.queueTiming, timing);
    await run(heartbeat, { status: "starting", startedAt: at + 1 });
    assert.equal(row.queueTiming, undefined);
    await run(updateQueueTiming, { sessionStartedAt: at, timing: { ...timing, observedAt: at + 2 } });
    assert.equal(row.queueTiming, undefined);
  } finally { if (previous === undefined) delete process.env.BROADCASTER_SECRET; else process.env.BROADCASTER_SECRET = previous; }
});
