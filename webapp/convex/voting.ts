import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { cleanIdentity, requireBroadcasterSecret } from "./lib";

const secretArg = { secret: v.string() };
const terminal = new Set(["playing", "cancelled"]);
const option = v.object({ label: v.string(), direction: v.string() });
async function settings(ctx: QueryCtx) {
  return ctx.db.query("settings").withIndex("by_key", q => q.eq("key", "main")).unique();
}
async function state(ctx: MutationCtx) {
  const existing = await ctx.db.query("voteState").withIndex("by_key", q => q.eq("key", "main")).unique();
  if (existing) return existing;
  return (await ctx.db.get(await ctx.db.insert("voteState", { key: "main" })))!;
}
async function announce(ctx: MutationCtx, round: Doc<"voteRounds">, kind: "vote-open" | "vote-winner" | "vote-playing", body: string) {
  await ctx.db.insert("messages", { author: "REACTOR TV", identity: "reactor-tv-system", systemKind: kind, roundId: round._id, body, createdAt: Date.now() });
}
function publicRound(round: Doc<"voteRounds"> | null) {
  if (!round) return null;
  return { _id: round._id, segmentTitle: round.segmentTitle, status: round.status, durationChunks: round.durationChunks,
    completedChunks: round.completedChunks, winnerIndex: round.winnerIndex, options: round.options.map(({ label, votes }) => ({ label, votes })) };
}
async function cancelRound(ctx: MutationCtx, round: Doc<"voteRounds">) {
  if (terminal.has(round.status)) return;
  await ctx.db.patch(round._id, { status: "cancelled" });
}
export async function cancelVoting(ctx: MutationCtx) {
  for (const status of ["prepared", "open", "closed", "claimed", "queued"] as const) {
    for (const round of await ctx.db.query("voteRounds").withIndex("by_status", q => q.eq("status", status)).collect()) await cancelRound(ctx, round);
  }
  const current = await state(ctx);
  await ctx.db.patch(current._id, { activeRoundId: undefined, lastWinnerId: undefined, runId: undefined, currentClipId: undefined });
}
export const reset = mutation({ args: secretArg, handler: async (ctx, { secret }) => {
  requireBroadcasterSecret(secret); await cancelVoting(ctx);
} });
export const current = query({ args: { identity: v.optional(v.string()) }, handler: async (ctx, { identity }) => {
  const enabled = (await settings(ctx))?.interactionMode === "voting";
  const current = await ctx.db.query("voteState").withIndex("by_key", q => q.eq("key", "main")).unique();
  const round = enabled && current?.activeRoundId ? await ctx.db.get(current.activeRoundId) : null;
  const last = enabled && current?.lastWinnerId ? await ctx.db.get(current.lastWinnerId) : null;
  const ballot = round && identity ? await ctx.db.query("ballots").withIndex("by_round_identity", q => q.eq("roundId", round._id).eq("identity", cleanIdentity(identity))).unique() : null;
  return { enabled, round: publicRound(round), lastWinner: publicRound(last), choice: ballot?.option ?? null };
} });
export const cast = mutation({ args: { roundId: v.id("voteRounds"), identity: v.string(), option: v.number() }, handler: async (ctx, args) => {
  const identity = cleanIdentity(args.identity);
  if (!identity || identity !== args.identity) throw new Error("Missing viewer identity");
  if ((await settings(ctx))?.interactionMode !== "voting") throw new Error("Audience voting is not enabled");
  const round = await ctx.db.get(args.roundId);
  const current = await state(ctx);
  if (!round || round.status !== "open" || current.activeRoundId !== round._id) throw new Error("This vote is closed");
  if (!Number.isInteger(args.option) || args.option < 0 || args.option >= 4) throw new Error("Choose one of the four options");
  const previous = await ctx.db.query("ballots").withIndex("by_round_identity", q => q.eq("roundId", round._id).eq("identity", identity)).unique();
  if (previous?.option === args.option) return;
  const options = round.options.map(value => ({ ...value }));
  if (previous) { options[previous.option].votes--; await ctx.db.patch(previous._id, { option: args.option }); }
  else await ctx.db.insert("ballots", { roundId: round._id, identity, option: args.option });
  options[args.option].votes++;
  await ctx.db.patch(round._id, { options });
} });

// Claim only for the same segment run. A scheduled boundary takes precedence.
export const planning = mutation({ args: { ...secretArg, runId: v.string() }, handler: async (ctx, { secret, runId }) => {
  requireBroadcasterSecret(secret);
  if ((await settings(ctx))?.interactionMode !== "voting") return { prepare: false, winner: null };
  const rounds = await ctx.db.query("voteRounds").withIndex("by_run", q => q.eq("runId", runId)).collect();
  const closed = rounds.find(round => round.status === "closed");
  if (closed && closed.winnerIndex !== undefined) {
    await ctx.db.patch(closed._id, { status: "claimed" });
    return { prepare: true, winner: { id: closed._id, ...closed.options[closed.winnerIndex] } };
  }
  return { prepare: !rounds.some(round => !terminal.has(round.status)), winner: null };
} });
export const release = mutation({ args: { ...secretArg, roundId: v.id("voteRounds") }, handler: async (ctx, { secret, roundId }) => {
  requireBroadcasterSecret(secret);
  const round = await ctx.db.get(roundId);
  if (round?.status === "claimed") await ctx.db.patch(roundId, { status: "closed" });
} });

async function openRound(ctx: MutationCtx, round: Doc<"voteRounds">, now: number) {
  if (round.status !== "prepared") return;
  await ctx.db.patch(round._id, { status: "open", openedAt: now });
  const current = await state(ctx);
  await ctx.db.patch(current._id, { activeRoundId: round._id });
  await announce(ctx, round, "vote-open", "Choose what happens next");
}

async function activateClip(ctx: MutationCtx, clip: Doc<"voteClips">, now: number) {
  const current = await state(ctx);
  if (clip.winnerRoundId) {
    const winner = await ctx.db.get(clip.winnerRoundId);
    if (winner && ["claimed", "queued"].includes(winner.status)) {
      await ctx.db.patch(winner._id, { status: "playing" });
      await ctx.db.patch(current._id, { lastWinnerId: winner._id });
      await announce(ctx, winner, "vote-playing", winner.options[winner.winnerIndex!].label);
    }
  }
  if (clip.roundToOpenId) { const round = await ctx.db.get(clip.roundToOpenId); if (round) await openRound(ctx, round, now); }
}

export const accepted = mutation({ args: { ...secretArg, clipId: v.string(), runId: v.string(), segmentTitle: v.string(),
  options: v.optional(v.array(option)), durationChunks: v.number(), winnerRoundId: v.optional(v.id("voteRounds")) }, handler: async (ctx, args) => {
  requireBroadcasterSecret(args.secret);
  if ((await settings(ctx))?.interactionMode !== "voting") return;
  if (!Number.isInteger(args.durationChunks) || args.durationChunks < 1 || args.durationChunks > 12) throw new Error("Invalid vote duration");
  const existing = await ctx.db.query("voteClips").withIndex("by_clip", q => q.eq("clipId", args.clipId)).unique();
  if (existing?.roundToOpenId) return;
  let roundToOpenId: Id<"voteRounds"> | undefined;
  if (args.options) {
    if (args.options.length !== 4 || new Set(args.options.map(o => o.label.toLowerCase())).size !== 4 || args.options.some(o => !o.label.trim() || o.label.length > 48 || !o.direction.trim() || o.direction.length > 240)) throw new Error("Four distinct short options are required");
    roundToOpenId = await ctx.db.insert("voteRounds", { runId: args.runId, segmentTitle: args.segmentTitle.slice(0, 100), anchorClipId: args.clipId,
      options: args.options.map(o => ({ ...o, votes: 0 })), durationChunks: args.durationChunks, completedChunks: 0, status: "prepared", createdAt: Date.now() });
  }
  const value = { clipId: args.clipId, runId: args.runId, roundToOpenId, winnerRoundId: args.winnerRoundId };
  if (existing) await ctx.db.patch(existing._id, value); else await ctx.db.insert("voteClips", value);
  if (args.winnerRoundId) {
    const winner = await ctx.db.get(args.winnerRoundId);
    if (winner?.status === "claimed") await ctx.db.patch(winner._id, { status: "queued" });
  }
  // A very fast clip may start before its registration reaches Convex.
  if (roundToOpenId && existing?.startedAt && !existing.finishedAt && (await state(ctx)).currentClipId === args.clipId) {
    await activateClip(ctx, (await ctx.db.get(existing._id))!, existing.startedAt);
  }
} });

export const playback = mutation({ args: { ...secretArg, clipId: v.string(), runId: v.string(), phase: v.union(v.literal("start"), v.literal("finish")) }, handler: async (ctx, { secret, clipId, runId, phase }) => {
  requireBroadcasterSecret(secret);
  if ((await settings(ctx))?.interactionMode !== "voting") return;
  let clip = await ctx.db.query("voteClips").withIndex("by_clip", q => q.eq("clipId", clipId)).unique();
  if (!clip && phase === "start") clip = await ctx.db.get(await ctx.db.insert("voteClips", { clipId, runId }));
  if (!clip) return;
  const now = Date.now();
  const current = await state(ctx);
  if (phase === "start") {
    if (clip.startedAt !== undefined) return;
    if (current.runId && current.runId !== runId) {
      for (const round of await ctx.db.query("voteRounds").withIndex("by_run", q => q.eq("runId", current.runId!)).collect()) await cancelRound(ctx, round);
    }
    await ctx.db.patch(clip._id, { startedAt: now });
    await ctx.db.patch(current._id, { runId, currentClipId: clipId, ...(current.runId !== runId ? { activeRoundId: undefined, lastWinnerId: undefined } : {}) });
    await activateClip(ctx, clip, now);
  } else {
    if (clip.startedAt === undefined || clip.finishedAt !== undefined) return;
    await ctx.db.patch(clip._id, { finishedAt: now });
    const round = current.activeRoundId ? await ctx.db.get(current.activeRoundId) : null;
    if (!round || round.status !== "open" || round.runId !== runId || clip.startedAt < (round.openedAt ?? Infinity)) return;
    const completedChunks = round.completedChunks + 1;
    if (completedChunks < round.durationChunks) { await ctx.db.patch(round._id, { completedChunks }); return; }
    // Stable option order breaks ties, including a round with no votes.
    const winnerIndex = round.options.reduce((best, o, i, all) => o.votes > all[best].votes ? i : best, 0);
    await ctx.db.patch(round._id, { completedChunks, winnerIndex, status: "closed", closedAt: now });
    await announce(ctx, round, "vote-winner", round.options[winnerIndex].label);
  }
} });
export const discard = mutation({ args: { ...secretArg, clipId: v.string() }, handler: async (ctx, { secret, clipId }) => {
  requireBroadcasterSecret(secret);
  const clip = await ctx.db.query("voteClips").withIndex("by_clip", q => q.eq("clipId", clipId)).unique();
  if (!clip || clip.startedAt !== undefined) return;
  if (clip.roundToOpenId) { const round = await ctx.db.get(clip.roundToOpenId); if (round) await cancelRound(ctx, round); }
  if (clip.winnerRoundId) { const round = await ctx.db.get(clip.winnerRoundId); if (round?.status === "queued") await ctx.db.patch(round._id, { status: "closed" }); }
} });
