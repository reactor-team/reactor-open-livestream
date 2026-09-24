import { CHAT_MESSAGE_TYPES, DEFAULT_BROADCAST_SETTINGS, normalizeChatMessageTypes } from "@reactor/infinite-contracts";
import { mergeVoteOutcomes } from "../../../webapp/src/lib/chat-messages";
import assert from "node:assert/strict";
import test from "node:test";
import * as voting from "../../../webapp/convex/voting";
import * as settings from "../../../webapp/convex/settings";
import * as chat from "../../../webapp/convex/chat";
import * as prompts from "../../../webapp/convex/prompts";
import { validateVoteOptions } from "../src/vote-options";
import { CerebrasStoryPlanner } from "../src/story-planner";

const secret = "vote-test-secret";
process.env.BROADCASTER_SECRET = secret;
type Row = Record<string, any>;
function context() {
  const tables = new Map<string, Row[]>();
  tables.set("viewers", [{ _id: "viewer-profile", identity: "viewer", name: "Riley", createdAt: 0 },
    { _id: "fake-profile", identity: "reactor-tv-system", name: "REACTOR_TV", createdAt: 0 }]);
  const table = (name: string) => { if (!tables.has(name)) tables.set(name, []); return tables.get(name)!; };
  const db = {
    query(name: string) {
      let rows = [...table(name)];
      const q = {
        withIndex(_index: string, filter?: (f: any) => void) { const f = { eq(key: string, value: unknown) { rows = rows.filter(row => row[key] === value); return f; } }; filter?.(f); return q; },
        order(direction: string) { rows.sort((a, b) => (direction === "desc" ? -1 : 1) * (a._creationTime - b._creationTime)); return q; },
        filter(predicate: (f: any) => boolean) { rows = rows.filter(row => predicate({ field: (key: string) => row[key], neq: (a: unknown, b: unknown) => a !== b })); return q; },
        collect: async () => rows, take: async (n: number) => rows.slice(0, n), first: async () => rows[0] ?? null,
        unique: async () => { assert.ok(rows.length <= 1); return rows[0] ?? null; },
      };
      return q;
    },
    get: async (id: string) => [...tables.values()].flat().find(row => row._id === id) ?? null,
    insert: async (name: string, value: Row) => { const _id = name + ":" + crypto.randomUUID(); table(name).push({ ...value, _id, _creationTime: Date.now() }); return _id; },
    patch: async (id: string, value: Row) => { const row = await db.get(id); assert.ok(row); Object.assign(row, value); },
  };
  return { db, tables };
}
async function run(fn: unknown, ctx: unknown, args: Row = {}): Promise<any> {
  return (fn as { _handler: (ctx: unknown, args: Row) => Promise<unknown> })._handler(ctx, { secret, ...args });
}
const choices = ["Open the box", "Pass it to Jim", "Hide the clipboard", "Ask Dwight to explain"].map(label => ({ label, direction: label + ", with a small natural reaction." }));
async function setup(durationChunks = 2) {
  const ctx = context();
  await run(settings.update, ctx, { chunkSeconds: 10, banner: "", interactionMode: "voting", voteDurationChunks: durationChunks });
  await run(settings.setChatMessageTypes, ctx, { enabledTypes: ["vote-open", "vote-closed", "vote-winner", "vote-playing"] });
  return ctx;
}
const accept = (ctx: unknown, clipId: string, extra: Row = {}) => run(voting.accepted, ctx, { clipId, runId: "run-1", segmentTitle: "Office", durationChunks: 2, ...extra });
const play = (ctx: unknown, clipId: string, phase: "start" | "finish", runId = "run-1") => run(voting.playback, ctx, { clipId, runId, phase });
const current = (ctx: unknown, identity = "viewer") => run(voting.current, ctx, { identity });

test("vote duration defaults to two; text mode remains the backwards-compatible default", async () => {
  const ctx = context();
  assert.deepEqual(await run(settings.get, ctx), { ...DEFAULT_BROADCAST_SETTINGS, viewerNamesRequired: true, chatSocialEnabled: true });
  for (const value of [0, 1.5, 13]) await assert.rejects(run(settings.update, ctx, { chunkSeconds: 10, banner: "", voteDurationChunks: value }), /Vote duration/);
});
test("viewer offset defaults to 0 for missing and legacy settings, persists zero, and survives unrelated saves", async () => {
  const ctx = context();
  assert.equal((await run(settings.get, ctx)).num_fake_viewers, 0);
  await ctx.db.insert("settings", { key: "main", chunkSeconds: 10, banner: "" });
  assert.equal((await run(settings.get, ctx)).num_fake_viewers, 0);
  const args = { chunkSeconds: 10, banner: "" };
  await run(settings.update, ctx, { ...args, num_fake_viewers: 75 });
  assert.equal((await run(settings.get, ctx)).num_fake_viewers, 75);
  await run(settings.update, ctx, args);
  assert.equal((await run(settings.get, ctx)).num_fake_viewers, 75);
  await run(settings.update, ctx, { ...args, num_fake_viewers: 0 });
  await run(settings.setChatMessageTypes, ctx, { enabledTypes: [] });
  await run(settings.update, ctx, args);
  assert.equal((await run(settings.get, ctx)).num_fake_viewers, 0);
  const fresh = context();
  await run(settings.update, fresh, args);
  assert.equal(fresh.tables.get("settings")?.[0].num_fake_viewers, 0);
  const chatFirst = context();
  await run(settings.setChatMessageTypes, chatFirst, { enabledTypes: [] });
  assert.equal(chatFirst.tables.get("settings")?.[0].num_fake_viewers, 0);
});

test("only authorized admins can set a bounded whole-number viewer offset", async () => {
  const ctx = context();
  const args = { chunkSeconds: 10, banner: "" };
  for (const value of [-1, 0.5, 1_000_001, NaN, Infinity]) {
    await assert.rejects(run(settings.update, ctx, { ...args, num_fake_viewers: value }), /num_fake_viewers must be a whole number/);
  }
  await assert.rejects(run(settings.update, ctx, { ...args, num_fake_viewers: 10, secret: "wrong" }), /Unauthorized/);
  assert.equal(ctx.tables.get("settings")?.length ?? 0, 0);
  await run(settings.update, ctx, { ...args, num_fake_viewers: 1_000_000 });
  assert.equal((await run(settings.get, ctx)).num_fake_viewers, 1_000_000);
});

test("rounds open on playback, count two completed chunks once, and freeze on close", async () => {
  const ctx = await setup();
  await accept(ctx, "a", { options: choices });
  assert.equal((await current(ctx)).round, null, "enqueue must not open voting early");
  await play(ctx, "a", "start");
  const id = (await current(ctx)).round._id;
  await run(voting.cast, ctx, { roundId: id, identity: "viewer", option: 2 });
  await run(voting.cast, ctx, { roundId: id, identity: "viewer", option: 2 });
  assert.equal((await current(ctx)).round.options[2].votes, 1);
  await run(voting.cast, ctx, { roundId: id, identity: "viewer", option: 1 });
  assert.deepEqual((await current(ctx)).round.options.map((o: Row) => o.votes), [0, 1, 0, 0]);
  await assert.rejects(run(voting.cast, ctx, { roundId: id, identity: "viewer", option: 4 }), /four options/);
  await play(ctx, "a", "finish"); await play(ctx, "a", "finish");
  assert.equal((await current(ctx)).round.completedChunks, 1);
  await accept(ctx, "b"); await play(ctx, "b", "start"); await play(ctx, "b", "finish");
  const closed = (await current(ctx)).round;
  assert.equal(closed.status, "closed"); assert.equal(closed.winnerIndex, 1);
  await assert.rejects(run(voting.cast, ctx, { roundId: id, identity: "late", option: 0 }), /closed/);
  assert.equal(ctx.tables.get("messages")?.filter(m => m.systemKind === "vote-open").length, 1);
  assert.equal(ctx.tables.get("messages")?.filter(m => m.systemKind === "vote-winner").length, 1);
});
test("winner is claimed exactly once; the next ballot opens atomically as its clip airs", async () => {
  const ctx = await setup(1);
  await accept(ctx, "a", { options: choices, durationChunks: 1 }); await play(ctx, "a", "start"); await play(ctx, "a", "finish");
  const claim = await run(voting.planning, ctx, { runId: "run-1" });
  assert.equal(claim.winner.label, choices[0].label, "no-vote ties use first option");
  assert.equal((await run(voting.planning, ctx, { runId: "run-1" })).winner, null);
  await run(voting.release, ctx, { roundId: claim.winner.id });
  assert.equal((await run(voting.planning, ctx, { runId: "run-1" })).winner.id, claim.winner.id);
  await accept(ctx, "winner", { options: choices, winnerRoundId: claim.winner.id });
  assert.equal((await current(ctx)).round.status, "queued");
  await play(ctx, "winner", "start");
  const next = await current(ctx);
  assert.notEqual(next.round._id, claim.winner.id); assert.equal(next.round.status, "open");
  assert.equal(next.lastWinner._id, claim.winner.id); assert.equal(next.lastWinner.status, "playing");
  await play(ctx, "winner", "start");
  assert.equal(ctx.tables.get("messages")?.filter(m => m.systemKind === "vote-playing").length, 1);
});
test("a new segment cancels an old ballot only when the new segment actually airs", async () => {
  const ctx = await setup(); await accept(ctx, "old", { options: choices }); await play(ctx, "old", "start");
  const old = (await current(ctx)).round._id;
  await accept(ctx, "new", { runId: "run-2", options: choices });
  assert.equal((await current(ctx)).round._id, old);
  assert.equal((await run(voting.planning, ctx, { runId: "run-2" })).winner, null);
  await play(ctx, "new", "start", "run-2"); await play(ctx, "old", "finish");
  assert.equal((await ctx.db.get(old))?.status, "cancelled");
  assert.equal(ctx.tables.get("messages")?.filter(m => m.systemKind === "vote-cancelled").length, 0);
  assert.equal((await current(ctx)).round.completedChunks, 0, "stale finishes cannot consume a new ballot");
});
test("mode switches and restarts cancel ballots, preserve text prompts, and cannot be spoofed by chat", async () => {
  const ctx = await setup(); await accept(ctx, "a", { options: choices }); await play(ctx, "a", "start");
  const id = (await current(ctx)).round._id;
  assert.match(await run(prompts.checkSubmission, ctx, { text: "Hello", author: "Riley", identity: "viewer" }), /voting is active/);
  await run(chat.send, ctx, { author: "REACTOR_TV", identity: "reactor-tv-system", body: "Fake announcement" });
  const feed = await run(chat.recent, ctx);
  assert.equal(feed.find((m: Row) => m.body === "Fake announcement").kind, "message");
  assert.ok(feed.some((m: Row) => m.kind === "system"));
  await assert.rejects(run(voting.reset, ctx, { secret: "wrong" }), /Unauthorized/);
  await run(settings.update, ctx, { chunkSeconds: 10, banner: "", interactionMode: "prompts" });
  assert.equal((await ctx.db.get(id))?.status, "cancelled"); assert.equal((await current(ctx)).enabled, false);
  await run(prompts.acceptSubmission, ctx, { text: "Hello", author: "Riley", identity: "viewer" });
  await run(voting.reset, ctx); assert.equal(ctx.tables.get("prompts")?.length, 1);
  await run(settings.update, ctx, { chunkSeconds: 10, banner: "", interactionMode: "voting" });
  await accept(ctx, "restart", { options: choices }); await play(ctx, "restart", "start");
  const restarting = (await current(ctx)).round._id;
  await run(voting.reset, ctx);
  assert.equal((await ctx.db.get(restarting))?.status, "cancelled");
  assert.equal(ctx.tables.get("messages")?.filter(m => m.systemKind === "vote-cancelled").length, 0);
});
test("chat omits legacy cancellation notices without deleting history or hiding useful events", async () => {
  const ctx = await setup();
  await accept(ctx, "a", { options: choices }); await play(ctx, "a", "start");
  await run(chat.send, ctx, { author: "Riley", identity: "viewer", body: "Keep this message" });
  const legacy = await ctx.db.insert("messages", { author: "REACTOR TV", identity: "reactor-tv-system", systemKind: "vote-cancelled", body: "Segment ended", createdAt: Date.now() });
  const feed = await run(chat.recent, ctx);
  assert.ok(feed.every((m: Row) => m.systemKind !== "vote-cancelled"));
  assert.ok(feed.some((m: Row) => m.systemKind === "vote-open"));
  assert.ok(feed.some((m: Row) => m.body === "Keep this message"));
  assert.ok(await ctx.db.get(legacy), "the stored history remains intact");
});
test("late clip registration still opens its vote and marks the winner on air", async () => {
  const ctx = await setup(); await accept(ctx, "a", { options: choices, durationChunks: 1 }); await play(ctx, "a", "start"); await play(ctx, "a", "finish");
  const plan = await run(voting.planning, ctx, { runId: "run-1" });
  await play(ctx, "fast", "start");
  await accept(ctx, "fast", { options: choices, winnerRoundId: plan.winner.id });
  const value = await current(ctx);
  assert.equal(value.round.status, "open"); assert.equal(value.lastWinner.status, "playing");
  assert.equal(value.lastWinner._id, plan.winner.id);
});
test("invalid or duplicate options never reach viewers; option expansion remains server-side", async () => {
  const ctx = await setup();
  assert.throws(() => validateVoteOptions(choices.slice(1)), /exactly four/);
  assert.throws(() => validateVoteOptions([choices[0], choices[0], choices[2], choices[3]]), /distinct/);
  assert.throws(() => validateVoteOptions([{ label: "x".repeat(49), direction: "x" }, ...choices.slice(1)]), /1-48/);
  await assert.rejects(accept(ctx, "bad", { options: choices.slice(1) }), /Four distinct/);
  await accept(ctx, "good", { options: choices }); await play(ctx, "good", "start");
  assert.ok((await current(ctx)).round.options.every((o: Row) => !("direction" in o)));
});
test("Cerebras writes four short choices from the same scene and constitution in one call", async () => {
  let request: any;
  let calls = 0;
  const planner = new CerebrasStoryPlanner({ apiKey: "test", model: "fixture", clipSeconds: 10, timeoutMs: 5000,
    fetchImpl: async (_url, init) => { calls++; request = JSON.parse(String(init?.body)); return Response.json({ choices: [{ message: { content: JSON.stringify({ visual: "Jim tilts the box toward the desk.", speaker: "", dialogue: "", sound: "Quiet office room tone.", choices }) } }] }); } });
  const plan = await planner.plan({ id: null, author: "Reactor", text: "A box on the desk", startsSegment: true, prepareVote: true, voteDurationChunks: 2, continuityNotes: "Keep the office geography." }, []);
  assert.deepEqual(plan.voteOptions, choices);
  assert.equal(calls, 1);
  assert.match(request.messages[0].content, /comic set-piece/);
  assert.match(request.messages[0].content, /character plus a strong concrete verb/);
  assert.match(request.messages[0].content, /ridiculous power move, a physical gag, a harmless social disaster/);
  assert.match(request.messages[0].content, /Keep its promise identical to the label/);
  assert.match(request.messages[0].content, /silently replace any option/);
  assert.match(request.messages[0].content, /ALL four need a surprising visible payoff/);
  assert.match(request.messages[0].content, /2 played chunks/);
  assert.match(request.messages[0].content, /FOUR distinct/); assert.match(request.messages[1].content, /office geography/);
  assert.ok(request.response_format.json_schema.schema.properties.choices);
  assert.ok(!plan.videoPrompt.includes(choices[0].label), "UI choices must not be rendered or spoken");
  const winner = { id: null, author: "Reactor", text: "Jim raises the box like a trophy.", voteWinnerRoundId: "round-1" };
  await planner.plan(winner, [plan], 8, "Keep the office geography.");
  assert.equal(calls, 2, "A winning beat still uses one scene completion");
  assert.match(request.messages[0].content, /Do not soften it into a glance, nod/);
  assert.doesNotMatch(request.messages[0].content, /Write one restrained|Also return choices/);
  assert.equal(JSON.parse(request.messages[1].content).direction, winner.text);
  assert.equal(JSON.parse(request.messages[1].content).constitution, "Keep the office geography.");
  assert.ok(!request.response_format.json_schema.schema.properties.choices);
  await planner.plan({id:null, author:"Reactor", text:"Continue naturally."}, [plan]);
  assert.match(request.messages[0].content, /Write one restrained, coherent/);
  assert.doesNotMatch(request.messages[0].content, /audience winner|Also return choices/);
});

test("system chat is off by default for new and legacy settings, including unknown future notices", async () => {
  const ctx = context();
  await ctx.db.insert("messages", { systemKind: "future-notice", body: "Future", createdAt: 20 });
  await ctx.db.insert("messages", { systemKind: "vote-winner", body: "Winner", createdAt: 10 });
  await run(chat.send, ctx, { body: "Hello", author: "REACTOR_TV", identity: "reactor-tv-system" });
  const visible = async () => (await run(chat.recent, ctx)).map((row: Row) => row.body);
  assert.deepEqual(await visible(), ["Hello"]);
  await run(settings.update, ctx, { chunkSeconds: 10, banner: "", interactionMode: "voting" });
  assert.deepEqual((await run(settings.get, ctx)).enabledChatMessageTypes, []);
  assert.deepEqual(await visible(), ["Hello"]);
  assert.deepEqual(normalizeChatMessageTypes(["*", "future-notice"]), []);
  await assert.rejects(run(settings.setChatMessageTypes, ctx, { enabledTypes: ["future-notice"] }), /Unknown/);
});

test("each notice type can be toggled globally without deleting history or changing broadcast settings", async () => {
  const ctx = context();
  await run(settings.update, ctx, { chunkSeconds: 8, banner: "Keep me", interactionMode: "voting", voteDurationChunks: 3 });
  const base = { segmentTitle: "Office", durationChunks: 2, completedChunks: 1, options: choices.map(o => ({ ...o, votes: 1 })) };
  const openRound = await ctx.db.insert("voteRounds", { ...base, status: "open" });
  const closedRound = await ctx.db.insert("voteRounds", { ...base, status: "closed", winnerIndex: 0 });
  for (const [i, type] of CHAT_MESSAGE_TYPES.entries()) await ctx.db.insert("messages", {
    body: type.id, systemKind: type.id === "vote-closed" ? "vote-open" : type.id,
    roundId: type.id === "vote-open" ? openRound : closedRound, createdAt: i + 1,
  });
  for (const type of CHAT_MESSAGE_TYPES) {
    await run(settings.setChatMessageTypes, ctx, { enabledTypes: [type.id] });
    assert.deepEqual((await run(chat.recent, ctx)).map((row: Row) => row.body), [type.id]);
    const value = await run(settings.get, ctx);
    assert.deepEqual(value, { chunkSeconds: 8, banner: "Keep me", interactionMode: "voting", voteDurationChunks: 3, num_fake_viewers: 0, enabledChatMessageTypes: [type.id], viewerNamesRequired: true, chatSocialEnabled: true });
  }
  await run(settings.setChatMessageTypes, ctx, { enabledTypes: CHAT_MESSAGE_TYPES.map(t => t.id) });
  assert.equal((await run(chat.recent, ctx)).length, CHAT_MESSAGE_TYPES.length);
  await run(settings.setChatMessageTypes, ctx, { enabledTypes: [] });
  assert.deepEqual(await run(chat.recent, ctx), []);
  assert.equal(ctx.tables.get("messages")!.length, CHAT_MESSAGE_TYPES.length);
  assert.equal((await ctx.db.get(openRound))!.status, "open");
  assert.equal((await ctx.db.get(closedRound))!.status, "closed");
});

test("ballot visibility follows its lifecycle while winner and on-air switches remain independent", async () => {
  const ctx = await setup(1);
  await run(settings.setChatMessageTypes, ctx, { enabledTypes: ["vote-open", "vote-winner"] });
  await accept(ctx, "a", { options: choices, durationChunks: 1 }); await play(ctx, "a", "start");
  assert.equal((await run(chat.recent, ctx)).length, 1);
  await play(ctx, "a", "finish");
  assert.deepEqual((await run(chat.recent, ctx)).map((row: Row) => row.systemKind), ["vote-winner"]);
  const plan = await run(voting.planning, ctx, { runId: "run-1" });
  await accept(ctx, "b", { winnerRoundId: plan.winner.id }); await play(ctx, "b", "start");
  const feed = async () => mergeVoteOutcomes((await run(chat.recent, ctx)).reverse()) as Row[];
  assert.deepEqual((await feed()).map(row => row.systemKind), ["vote-winner"]);
  await run(settings.setChatMessageTypes, ctx, { enabledTypes: ["vote-playing"] });
  assert.deepEqual((await feed()).map(row => row.systemKind), ["vote-playing"]);
  await run(settings.setChatMessageTypes, ctx, { enabledTypes: ["vote-winner", "vote-playing"] });
  assert.deepEqual((await feed()).map(row => row.systemKind), ["vote-playing"]);
  assert.ok(!(JSON.stringify(await feed()).includes('"direction"')), "private generation directions stay private");
});

test("hidden system history cannot displace viewer messages or prompt status from the recent feed", async () => {
  const ctx = context();
  await run(prompts.acceptSubmission, ctx, { text: "Viewer prompt", author: "Riley", identity: "viewer" });
  for (let i = 0; i < 99; i++) await run(chat.send, ctx, { body: "Chat " + i, author: "Riley", identity: "viewer" });
  for (let i = 0; i < 150; i++) await ctx.db.insert("messages", { systemKind: "vote-winner", body: "Hidden " + i, createdAt: Date.now() + i });
  const feed = await run(chat.recent, ctx);
  assert.equal(feed.length, 100);
  assert.ok(feed.every((row: Row) => row.kind !== "system"));
  assert.equal(feed.find((row: Row) => row.kind === "prompt").promptStatus, "pending");
});

test("chat visibility mutations require authorization, preserve other settings and default future types off", async () => {
  const ctx = context();
  await assert.rejects(run(settings.setChatMessageTypes, ctx, { secret: "wrong", enabledTypes: ["vote-winner"] }), /Unauthorized/);
  assert.equal(ctx.tables.get("settings"), undefined);
  await run(settings.setChatMessageTypes, ctx, { enabledTypes: ["vote-winner", "vote-winner"] });
  assert.deepEqual((await run(settings.get, ctx)).enabledChatMessageTypes, ["vote-winner"]);
  await run(settings.update, ctx, { chunkSeconds: 12, banner: "Still enabled" });
  assert.deepEqual((await run(settings.get, ctx)).enabledChatMessageTypes, ["vote-winner"]);
  // Old or future deployment data cannot opt viewers into an unregistered message.
  const row = ctx.tables.get("settings")![0];
  await ctx.db.patch(row._id, { enabledChatMessageTypes: ["vote-winner", "unregistered"] });
  await ctx.db.insert("messages", { systemKind: "unregistered", body: "Hidden", createdAt: 10 });
  assert.deepEqual((await run(settings.get, ctx)).enabledChatMessageTypes, ["vote-winner"]);
  assert.deepEqual(await run(chat.recent, ctx), []);
});
