import { BROADCAST_KEY, publicBroadcastDetail } from "@reactor/infinite-contracts";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireBroadcasterSecret } from "./lib";
import { queueTiming } from "./lib/queueTiming";

const status = v.union(
  v.literal("offline"),
  v.literal("starting"),
  v.literal("live"),
  v.literal("degraded"),
);

export const get = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("broadcasts")
      .withIndex("by_key", (q) => q.eq("key", BROADCAST_KEY))
      .unique();

    return row ? { ...row, detail: publicBroadcastDetail(row.status) } : {
      key: BROADCAST_KEY,
      queueTiming: undefined,
      status: "offline" as const,
      detail: publicBroadcastDetail("offline"),
      currentPrompt: undefined,
      currentAuthor: undefined,
      currentChunkStartedAt: undefined,
      currentSegmentStartedAt: undefined,
      continuous: false,
      segment: undefined,
      table: undefined,
      heartbeatAt: undefined,
      startedAt: undefined,
    };
  },
});

export const heartbeat = mutation({
  args: {
    secret: v.string(),
    status,
    detail: v.optional(v.string()),
    currentPrompt: v.optional(v.string()),
    currentAuthor: v.optional(v.string()),
    currentChunkStartedAt: v.optional(v.number()),
    currentSegmentStartedAt: v.optional(v.number()),
    continuous: v.optional(v.boolean()),
    segment: v.optional(v.object({ chunkSeconds: v.optional(v.number()), id: v.optional(v.string()), title: v.string(), durationSeconds: v.number() })),
    table: v.optional(v.object({ runId: v.string(), lengthCm: v.number(), revision: v.number() })),
    startedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireBroadcasterSecret(args.secret);
    const existing = await ctx.db
      .query("broadcasts")
      .withIndex("by_key", (q) => q.eq("key", BROADCAST_KEY))
      .unique();
    const heartbeatAt = Date.now();
    const value = {
      key: BROADCAST_KEY,
      status: args.status,
      detail: args.detail,
      currentPrompt: args.currentPrompt,
      currentAuthor: args.currentAuthor,
      currentChunkStartedAt: args.currentChunkStartedAt,
      currentSegmentStartedAt: args.currentSegmentStartedAt,
      continuous: args.continuous,
      segment: args.segment,
      table: args.table,
      heartbeatAt,
      startedAt: args.startedAt,
      ...(!existing || existing.startedAt !== args.startedAt || args.status === "offline" ? { queueTiming: undefined } : {}),
    } as const;

    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("broadcasts", value);

    await ctx.scheduler.runAfter(45_000, internal.broadcast.expire, { heartbeatAt });
  },
});

/** Timing updates do not refresh liveness or schedule extra expiry jobs. */
export const updateQueueTiming = mutation({
  args: { secret: v.string(), sessionStartedAt: v.number(), timing: queueTiming },
  handler: async (ctx, { secret, sessionStartedAt, timing }) => {
    requireBroadcasterSecret(secret);
    const row = await ctx.db.query("broadcasts").withIndex("by_key", q => q.eq("key", BROADCAST_KEY)).unique();
    if (!row || row.status === "offline" || row.startedAt !== sessionStartedAt) return;
    if (row.queueTiming && row.queueTiming.observedAt >= timing.observedAt) return;
    if (!Number.isFinite(timing.observedAt) || Math.abs(Date.now() - timing.observedAt) > 30000
      || timing.clips.length > 6 || timing.generationRates.length > 12 || timing.planningSeconds.length > 12
      || [...timing.generationRates, ...timing.planningSeconds].some(n => !Number.isFinite(n) || n <= 0)
      || timing.clips.some(clip => !Number.isFinite(clip.seconds) || clip.seconds <= 0 || clip.seconds > 30
        || [clip.enqueuedAt, clip.generationStartedAt, clip.generatedAt, clip.startedAt].some(at => at !== undefined && (!Number.isFinite(at) || at < 0)))
      || (timing.planning && (!Number.isFinite(timing.planning.startedAt) || !Number.isFinite(timing.planning.seconds) || timing.planning.seconds <= 0 || timing.planning.seconds > 30))) return;
    await ctx.db.patch(row._id, { queueTiming: timing });
  },
});

export const expire = internalMutation({
  args: { heartbeatAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("broadcasts")
      .withIndex("by_key", (q) => q.eq("key", BROADCAST_KEY))
      .unique();
    if (!existing || existing.heartbeatAt !== args.heartbeatAt) return;
    await ctx.db.patch(existing._id, {
      status: "offline",
      detail: "Broadcaster heartbeat expired",
    });
  },
});
