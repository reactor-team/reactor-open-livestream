import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { activeViewerPrompt, orderedWaitingPrompts, promptTimings, PROMPT_LIMIT_REASON, type QueueTiming } from "@reactor/infinite-contracts";
import * as prompts from "../../../webapp/convex/prompts";
import * as chat from "../../../webapp/convex/chat";

type Row = Record<string, any> & { _id: string };
function context() {
  const tables = new Map<string, Row[]>();
  tables.set("viewers", ["browser-a", "browser-b"].map(identity => ({ _id: identity, identity, name: "Riley", createdAt: 0 })));
  const table = (name: string) => { if (!tables.has(name)) tables.set(name, []); return tables.get(name)!; };
  const db = {
    query(name: string) {
      let rows = [...table(name)];
      const q = {
        withIndex(_index: string, filter?: (f: any) => void) {
          const f = { eq(key: string, value: unknown) { rows = rows.filter(row => row[key] === value); return f; } };
          filter?.(f); return q;
        },
        collect: async () => rows, first: async () => rows[0] ?? null, unique: async () => rows[0] ?? null,
        order() { return q; }, take: async (limit: number) => rows.slice(0, limit),
      };
      return q;
    },
    get: async (id: string) => [...tables.values()].flat().find(row => row._id === id) ?? null,
    insert: async (name: string, data: object) => { const _id = crypto.randomUUID(); table(name).push({ ...data, _id, _creationTime: Date.now() }); return _id; },
    patch: async (id: string, data: object) => { const row = await db.get(id); assert.ok(row); Object.assign(row, data); },
  };
  return { db };
}
const run = (fn: any, ctx: any, args: object = {}) => fn._handler(ctx, args);
const submission = { text: "A paper plane glides past.", author: "Riley", identity: "browser-a" };

test("confirmed playback retires stale playing prompts but preserves pending and queued requests", async () => {
  const previousSecret = process.env.BROADCASTER_SECRET;
  process.env.BROADCASTER_SECRET = "queue-test-secret";
  try {
    const ctx = context();
    const old = await ctx.db.insert("prompts", { ...submission, status: "playing", createdAt: 1, startedAt: 2 });
    const next = await ctx.db.insert("prompts", { ...submission, identity: "browser-b", status: "queued", createdAt: 3 });
    const waiting = await ctx.db.insert("prompts", { ...submission, identity: "browser-c", status: "pending", createdAt: 4 });
    await assert.rejects(run(prompts.markPlaying, ctx, { secret: "wrong", id: next }), /Unauthorized/);
    assert.equal((await ctx.db.get(old))?.status, "playing");
    await run(prompts.markPlaying, ctx, { secret: "queue-test-secret", id: next });
    assert.equal((await ctx.db.get(old))?.status, "played");
    assert.equal(await run(prompts.checkSubmission, ctx, submission), null, "the original viewer can submit again");
    assert.equal((await ctx.db.get(next))?.status, "playing");
    await run(prompts.markPlaying, ctx, { secret: "queue-test-secret", id: old });
    assert.equal((await ctx.db.get(next))?.status, "playing", "a late start for a completed prompt cannot retire its successor");
    const startedAt = (await ctx.db.get(next))?.startedAt;
    await run(prompts.markPlaying, ctx, { secret: "queue-test-secret", id: next });
    assert.equal((await ctx.db.get(next))?.startedAt, startedAt, "duplicate starts do not reset the clock");
    await run(prompts.markPlaying, ctx, { secret: "queue-test-secret" });
    assert.equal((await ctx.db.get(next))?.status, "played", "automatic continuation also releases the viewer");
    assert.equal((await ctx.db.get(waiting))?.status, "pending");
    const endedAt = (await ctx.db.get(next))?.finishedAt;
    await run(prompts.markPlayed, ctx, { secret: "queue-test-secret", id: next });
    assert.equal((await ctx.db.get(next))?.finishedAt, endedAt, "late finishes are idempotent");
  } finally {
    if (previousSecret === undefined) delete process.env.BROADCASTER_SECRET;
    else process.env.BROADCASTER_SECRET = previousSecret;
  }
});

test("one active prompt blocks further submissions in every stage", async () => {
  for (const status of ["pending", "queued", "playing"]) {
    const ctx = context();
    const id = await ctx.db.insert("prompts", { ...submission, status, createdAt: 1 });
    const renamed = { ...submission, text: "A second idea." };
    assert.equal(await run(prompts.checkSubmission, ctx, renamed), PROMPT_LIMIT_REASON);
    assert.deepEqual(await run(prompts.acceptSubmission, ctx, renamed), { status: "invalid", reason: PROMPT_LIMIT_REASON });
    assert.equal((await run(prompts.active, ctx)).length, 1);
    assert.equal((await run(chat.recent, ctx)).length, 0);
    assert.equal(await run(prompts.submissionStatus, ctx, { id, identity: submission.identity }), status);
  }
});

test("another viewer is independent and the original viewer can submit once theirs finishes", async () => {
  const ctx = context();
  const first = await run(prompts.acceptSubmission, ctx, submission);
  assert.equal(first.status, "accepted");
  const second = await run(prompts.acceptSubmission, ctx, { ...submission, identity: "browser-b" });
  assert.equal(second.status, "accepted");
  assert.equal((await run(prompts.active, ctx)).length, 2);
  await ctx.db.patch(first.promptId, { status: "played" });
  assert.equal(await run(prompts.submissionStatus, ctx, { id: first.promptId, identity: submission.identity }), "played");
  assert.equal((await run(prompts.acceptSubmission, ctx, submission)).status, "accepted");
  assert.equal((await run(prompts.active, ctx)).length, 2);
});

test("an acknowledgement reveals only the matching viewer's status", async () => {
  const ctx = context();
  const { promptId: id } = await run(prompts.acceptSubmission, ctx, submission);
  assert.equal(await run(prompts.submissionStatus, ctx, { id, identity: "someone-else" }), null);
  assert.equal(await run(prompts.submissionStatus, ctx, { id: "missing", identity: submission.identity }), null);
});

test("queued clips rank by claim order, priorities first, with stable creation-time ties", () => {
  const rows = [
    { _id: "pending", status: "pending", createdAt: 1 },
    { _id: "later-claim", status: "queued", createdAt: 1, queuedAt: 20 },
    { _id: "first-claim", status: "queued", createdAt: 2, queuedAt: 10 },
    { _id: "priority", status: "pending", createdAt: 40, playNow: true },
    { _id: "playing", status: "playing", createdAt: 0 },
    { _id: "a-tie", status: "pending", createdAt: 2, _creationTime: 3 },
    { _id: "z-tie", status: "pending", createdAt: 2, _creationTime: 2 },
  ];
  assert.deepEqual(orderedWaitingPrompts(rows).map(p => p._id), ["priority", "first-claim", "later-claim", "pending", "z-tie", "a-tie"]);
});

test("chat and shared forecast advance queue position as the preceding prompt starts", async () => {
  const ctx = context();
  const first = await ctx.db.insert("prompts", { ...submission, status: "queued", createdAt: 2, queuedAt: 10 });
  const second = await ctx.db.insert("prompts", { ...submission, identity: "browser-b", status: "queued", createdAt: 1, queuedAt: 20 });
  const third = await ctx.db.insert("prompts", { ...submission, identity: "browser-c", status: "pending", createdAt: 3 });
  for (const id of [first, second, third]) await ctx.db.insert("messages", { body: submission.text, identity: submission.identity, author: "Viewer", promptId: id, createdAt: 1 });
  const inspect = async () => {
    const active = await run(prompts.active, ctx);
    const feed = await run(chat.recent, ctx);
    const states = promptTimings({ prompts: active, status: "live", now: 100, chunkSeconds: 6 });
    for (const entry of feed) assert.equal(states.get(entry.promptId)?.queuePosition, entry.queuePosition);
    return states;
  };
  const before = await inspect();
  assert.equal(before.get(second)?.label, "#2 in queue · Preparing prompt");
  assert.equal(before.get(third)?.label, "#3 in queue");
  await ctx.db.patch(first, { status: "playing" });
  const after = await inspect();
  assert.equal(after.get(second)?.queueLabel, "#1 in queue");
  assert.equal(after.get(third)?.queueLabel, "#2 in queue");
  assert.equal(after.get(first)?.label, "Playing now");
});

test("queue position remains visible during generation, buffering, recovery and voting pauses", () => {
  const now = 100000;
  const rows = [
    { _id: "first", status: "queued", createdAt: 1, queuedAt: 10 },
    { _id: "second", status: "queued", createdAt: 2, queuedAt: 20 },
  ];
  const timing: QueueTiming = { observedAt: now, planningSeconds: [1], generationRates: [1, 1], clips: [
    { clipId: "a", promptId: "first", seconds: 6, enqueuedAt: now - 10000, generatedAt: now - 5000 },
    { clipId: "b", promptId: "second", seconds: 6, enqueuedAt: now - 5000, generationStartedAt: now - 5000 },
  ] };
  const state = (status = "live") => promptTimings({ prompts: rows, status, now, timing, chunkSeconds: 6 }).get("second")!;
  assert.match(state().label, /^#2 in queue · about \d+s$/);
  assert.match(state().title!, /^Generating video\./);
  timing.clips[1].generatedAt = now;
  assert.match(state().label, /^#2 in queue · about \d+s$/);
  assert.match(state().title!, /^Buffered\./);
  assert.equal(state("degraded").label, "#2 in queue · Waiting for stream to recover");
  assert.equal(state("offline").label, "#2 in queue · Queued for next broadcast");
  const paused = promptTimings({ prompts: rows.map(row => ({ ...row, status: "pending" })), status: "live", now, chunkSeconds: 6, voting: true });
  assert.equal(paused.get("second")?.label, "#2 in queue · Saved for text mode");
});

test("composer lock follows identity and excludes finished prompts without discarding drafts", () => {
  const active = [{ identity: "browser-a", status: "pending" }, { identity: "browser-b", status: "playing" }, { identity: "browser-c", status: "played" }];
  assert.equal(activeViewerPrompt(active, "browser-a"), active[0]);
  assert.equal(activeViewerPrompt(active, "browser-b"), active[1]);
  assert.equal(activeViewerPrompt(active, "browser-c"), undefined);
  assert.equal(activeViewerPrompt(undefined, "browser-a"), undefined);
  const app = readFileSync("../../webapp/src/app/stream/broadcast-app.tsx", "utf8");
  const hook = readFileSync("../../webapp/src/app/stream/use-prompt-submission.ts", "utf8");
  const composer = readFileSync("../../webapp/src/app/stream/prompt-composer.tsx", "utf8");
  assert.ok(app.includes("const promptBlockedReason = promptUnavailableReason({"));
  assert.ok(app.includes("if (reason) { showBlockedNotice(reason); return; }"));
  assert.ok(app.includes('setPrompt(current => current === text ? "" : current)'));
  assert.ok(composer.includes("onFocus={explainOnce}"));
  assert.ok(!composer.includes(" disabled="));
  assert.ok(composer.includes('className="sr-only" id="prompt-queue-status" role="status"'));
  assert.ok(!app.includes('className="prompt-queue-status"'));
  assert.ok(app.includes('"Say something or type /prompt"'));
  assert.ok(!readFileSync("../../webapp/src/app/globals.css", "utf8").includes(".prompt-queue-status"));
  assert.ok(hook.includes('receiptStatus !== "played" && receiptStatus !== "blocked" && receiptStatus !== null'));
  assert.ok(hook.includes("setReceipt({ id: result.promptId, identity: input.identity })"));
});
