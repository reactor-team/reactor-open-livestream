import { BROADCAST_KEY, DEFAULT_BROADCAST_SETTINGS, isValidFakeViewerCount, MAX_FAKE_VIEWERS, normalizeChatMessageTypes } from "@reactor/infinite-contracts";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { cleanText, requireBroadcasterSecret } from "./lib";
import { cancelVoting } from "./voting";
import { readPromptModeration } from "./lib/promptModerationSettings";
import { validatePromptCriteria } from "./lib/promptModerationPolicy";

const MIN_CHUNK_SECONDS = 6;
const MAX_CHUNK_SECONDS = 14;

// Criteria are admin-only; the viewer settings query does not expose them.
export const getPromptModeration = query({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requireBroadcasterSecret(args.secret);
    return readPromptModeration(ctx);
  },
});

export const setPromptModeration = mutation({
  args: { secret: v.string(), criteria: v.array(v.string()), expectedRevision: v.number() },
  handler: async (ctx, args) => {
    requireBroadcasterSecret(args.secret);
    const criteria = validatePromptCriteria(args.criteria);
    if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) throw new Error("Invalid moderation revision");
    const current = await readPromptModeration(ctx);
    if (JSON.stringify(criteria) === JSON.stringify(current.criteria)) return { status: "saved" as const, revision: current.revision, criteria };
    if (args.expectedRevision !== current.revision) return { status: "conflict" as const };
    const existing = await ctx.db.query("settings").withIndex("by_key", q => q.eq("key", BROADCAST_KEY)).unique();
    const revision = current.revision + 1;
    const value = { promptModerationCriteria: criteria, promptModerationRevision: revision, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("settings", { key: BROADCAST_KEY, ...DEFAULT_BROADCAST_SETTINGS, ...value });
    return { status: "saved" as const, revision, criteria };
  },
});

export const get = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", BROADCAST_KEY))
      .unique();

    const settings = row
      ? {
          chunkSeconds: row.chunkSeconds,
          banner: row.banner,
          interactionMode: row.interactionMode ?? "prompts",
          voteDurationChunks: row.voteDurationChunks ?? 2,
          num_fake_viewers: row.num_fake_viewers ?? DEFAULT_BROADCAST_SETTINGS.num_fake_viewers,
          enabledChatMessageTypes: normalizeChatMessageTypes(row.enabledChatMessageTypes),
        }
      : DEFAULT_BROADCAST_SETTINGS;
    // Clients skip the name query until the matching backend release is available.
    return { ...settings, viewerNamesRequired: true as const, chatSocialEnabled: true as const };
  },
});

export const update = mutation({
  args: {
    secret: v.string(),
    chunkSeconds: v.number(),
    banner: v.string(),
    interactionMode: v.optional(v.union(v.literal("prompts"), v.literal("voting"))),
    voteDurationChunks: v.optional(v.number()),
    num_fake_viewers: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireBroadcasterSecret(args.secret);
    if (args.num_fake_viewers !== undefined && !isValidFakeViewerCount(args.num_fake_viewers)) {
      throw new Error(`num_fake_viewers must be a whole number from 0 to ${MAX_FAKE_VIEWERS}`);
    }
    const chunkSeconds = Math.round(args.chunkSeconds);
    const banner = cleanText(args.banner, 240);
    if (args.voteDurationChunks !== undefined && (!Number.isInteger(args.voteDurationChunks) || args.voteDurationChunks < 1 || args.voteDurationChunks > 12)) throw new Error("Vote duration must be 1 to 12 chunks");

    if (chunkSeconds < MIN_CHUNK_SECONDS || chunkSeconds > MAX_CHUNK_SECONDS) {
      throw new Error(`Chunk length must be ${MIN_CHUNK_SECONDS} to ${MAX_CHUNK_SECONDS} seconds`);
    }

    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", BROADCAST_KEY))
      .unique();
    const value = {
      key: BROADCAST_KEY,
      chunkSeconds,
      banner,
      interactionMode: args.interactionMode ?? existing?.interactionMode ?? "prompts",
      voteDurationChunks: args.voteDurationChunks ?? existing?.voteDurationChunks ?? 2,
      num_fake_viewers: args.num_fake_viewers ?? existing?.num_fake_viewers ?? DEFAULT_BROADCAST_SETTINGS.num_fake_viewers,
      updatedAt: Date.now(),
    } as const;

    const wasVoting = existing?.interactionMode === "voting";
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("settings", value);

    if (value.interactionMode !== "voting" && wasVoting) await cancelVoting(ctx);

    return { chunkSeconds, banner };
  },
});

// Independent from broadcast parameters so a visibility save cannot change playback.
export const setChatMessageTypes = mutation({
  args: { secret: v.string(), enabledTypes: v.array(v.string()) },
  handler: async (ctx, args) => {
    requireBroadcasterSecret(args.secret);
    const enabledChatMessageTypes = normalizeChatMessageTypes(args.enabledTypes);
    if (args.enabledTypes.some(type => !enabledChatMessageTypes.some(known => known === type))) {
      throw new Error("Unknown chat message type");
    }
    const existing = await ctx.db.query("settings")
      .withIndex("by_key", q => q.eq("key", BROADCAST_KEY)).unique();
    const value = { enabledChatMessageTypes, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("settings", { key: BROADCAST_KEY, ...DEFAULT_BROADCAST_SETTINGS, ...value });
    return { enabledChatMessageTypes };
  },
});
