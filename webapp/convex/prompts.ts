import { v } from "convex/values";
import { ACTIVE_PROMPT_STATUSES, PROMPT_LIMIT_REASON, hasUnsafePromptEncoding, PROMPT_ENCODING_REASON } from "@reactor/infinite-contracts";

import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { moderatePrompt, type ModerationResult } from "./lib/promptModeration";
import { saveViewerName, viewerNameSubmissionError } from "./lib/viewerNames";
import { readPromptModeration } from "./lib/promptModerationSettings";
import { awardPromptStar, resolveMentions } from "./lib/chatSocial";
import {
  cleanAuthor,
  cleanIdentity,
  promptText,
  requireBroadcasterSecret,
} from "./lib";

export const active = query({
  args: {},
  handler: async (ctx) => {
    const [playing, queued, pending] = await Promise.all([
      ctx.db.query("prompts").withIndex("by_status_created", (q) => q.eq("status", "playing")).collect(),
      ctx.db.query("prompts").withIndex("by_status_created", (q) => q.eq("status", "queued")).collect(),
      ctx.db.query("prompts").withIndex("by_status_created", (q) => q.eq("status", "pending")).collect(),
    ]);
    return [...playing, ...queued, ...pending].map((prompt) => ({
      _id: prompt._id,
      _creationTime: prompt._creationTime,
      text: prompt.text,
      author: prompt.author,
      identity: prompt.identity,
      status: prompt.status,
      playNow: prompt.playNow,
      chunkSeconds: prompt.chunkSeconds,
      createdAt: prompt.createdAt,
      queuedAt: prompt.queuedAt,
      startedAt: prompt.startedAt,
    }));
  },
});

// A successful action stays locked locally until this reactive receipt retires.
export const submissionStatus = query({
  args: { id: v.id("prompts"), identity: v.string(), includeBlocked: v.optional(v.boolean()) },
  handler: async (ctx, { id, identity, includeBlocked }) => {
    const prompt = await ctx.db.get(id);
    // Older clients release a missing receipt but do not recognize blocked state.
    if (prompt?.status === "blocked" && !includeBlocked) return null;
    return prompt && prompt.identity === cleanIdentity(identity) ? prompt.status : null;
  },
});

const submissionArgs = { text: v.string(), author: v.string(), identity: v.string() };
type Submission = { text: string; author: string; identity: string };
type SubmissionResult = { status: "accepted"; promptId: Id<"prompts"> }
  | Exclude<ModerationResult, { status: "allowed" }>
  | { status: "invalid"; reason: string };

function normalizeSubmission(args: Submission): Submission {
  return { text: promptText(args.text), author: cleanAuthor(args.author), identity: cleanIdentity(args.identity) };
}

async function submissionError(ctx: QueryCtx, { text, author, identity }: Submission): Promise<string | null> {
  if (!text) return "Write a prompt first.";
  if (!author) return "Choose a name first.";
  if (!identity) return "Missing viewer identity.";
  if (hasUnsafePromptEncoding(text) || hasUnsafePromptEncoding(author)) return PROMPT_ENCODING_REASON;
  const nameError = await viewerNameSubmissionError(ctx, identity, author);
  if (nameError) return nameError;
  const settings = await ctx.db.query("settings").withIndex("by_key", q => q.eq("key", "main")).unique();
  if (settings?.interactionMode === "voting") return "Audience voting is active. Choose an option in the player.";
  for (const state of ACTIVE_PROMPT_STATUSES) {
    const existing = await ctx.db.query("prompts")
      .withIndex("by_identity_status", q => q.eq("identity", identity).eq("status", state)).first();
    if (existing) return PROMPT_LIMIT_REASON;
  }
  const waiting = await ctx.db.query("prompts").withIndex("by_status_created", q => q.eq("status", "pending")).take(64);
  if (waiting.length >= 64) return "The prompt queue is full. Please try again after some prompts have aired.";
  return null;
}

export const checkSubmission = internalQuery({
  args: submissionArgs,
  handler: async (ctx, args) => submissionError(ctx, normalizeSubmission(args)),
});

// Only the moderation action can publish an ordinary viewer prompt.
export const getModerationSettings = internalQuery({ args: {}, handler: readPromptModeration });

export const acceptSubmission = internalMutation({
  args: { ...submissionArgs, moderationRevision: v.optional(v.number()) },
  handler: async (ctx, args): Promise<SubmissionResult> => {
    const input = normalizeSubmission(args);
    const reason = await submissionError(ctx, input);
    if (reason) return { status: "invalid", reason };
    const policy = await readPromptModeration(ctx);
    if ((args.moderationRevision ?? 0) !== policy.revision) return { status: "unavailable", reason: "The stream's moderation rules changed while checking. Please submit your prompt again." };
    await saveViewerName(ctx, input.identity, input.author);
    const createdAt = Date.now();
    const promptId = await ctx.db.insert("prompts", { ...input, status: "pending", createdAt });
    await ctx.db.insert("messages", { body: input.text, author: input.author, identity: input.identity, promptId, createdAt, mentions: await resolveMentions(ctx, input.text) });
    await awardPromptStar(ctx, promptId);
    return { status: "accepted", promptId };
  },
});

export const submit = action({
  args: submissionArgs,
  handler: async (ctx, args): Promise<SubmissionResult> => {
    const input = normalizeSubmission(args);
    const reason = await ctx.runQuery(internal.prompts.checkSubmission, input);
    if (reason) return { status: "invalid", reason };
    const policy = await ctx.runQuery(internal.prompts.getModerationSettings, {});
    const result = await moderatePrompt({ ...input, additionalCriteria: policy.criteria }, process.env.OPENAI_API_KEY);
    if (result.status !== "allowed") return result;
    // Recheck mode and queue limits atomically after the external check.
    return ctx.runMutation(internal.prompts.acceptSubmission, { ...input, moderationRevision: policy.revision });
  },
});

export const submitSegment = mutation({
  args: {
    secret: v.string(),
    text: v.string(),
    author: v.string(),
    identity: v.string(),
    openingFrameId: v.optional(v.id("_storage")),
    chunkSeconds: v.optional(v.number()),
    continuous: v.optional(v.boolean()),
    continuityNotes: v.optional(v.string()),
    voicePrompt: v.optional(v.string()),
    playNow: v.boolean(),
  },
  handler: async (ctx, args) => {
    requireBroadcasterSecret(args.secret);
    const text = promptText(args.text);
    const author = cleanAuthor(args.author);
    const identity = cleanIdentity(args.identity);
    const continuityNotes = args.continuityNotes?.trim().slice(0, 1_600);
    if (args.chunkSeconds !== undefined && (!Number.isInteger(args.chunkSeconds) || args.chunkSeconds < 6 || args.chunkSeconds > 14)) throw new Error("Chunk length must be 6 to 14 seconds");
    const voicePrompt = args.voicePrompt?.trim().slice(0, 360);
    if (!text) throw new Error("Write a prompt first");
    if (!author) throw new Error("Choose a name first");
    if (!identity) throw new Error("Missing viewer identity");

    if (!args.playNow) {
      const nameError = await viewerNameSubmissionError(ctx, identity, author);
      if (nameError) throw new Error(nameError);
      for (const state of ACTIVE_PROMPT_STATUSES) {
        const existing = await ctx.db
          .query("prompts")
          .withIndex("by_identity_status", (q) => q.eq("identity", identity).eq("status", state))
          .first();
        if (existing) throw new Error(PROMPT_LIMIT_REASON);
      }
      await saveViewerName(ctx, identity, author);
    }

    const createdAt = Date.now();
    const promptId = await ctx.db.insert("prompts", {
      text,
      author,
      identity,
      openingFrameId: args.openingFrameId,
      chunkSeconds: args.chunkSeconds,
      startsSegment: true,
      continuous: args.continuous || undefined,
      continuityNotes: continuityNotes || undefined,
      voicePrompt: voicePrompt || undefined,
      playNow: args.playNow || undefined,
      status: "pending",
      createdAt,
    });
    if (!args.playNow) {
      await ctx.db.insert("messages", { body: text, author, identity, promptId, createdAt, mentions: await resolveMentions(ctx, text) });
      await awardPromptStar(ctx, promptId);
    }
    return promptId;
  },
});

export const resetInFlight = mutation({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requireBroadcasterSecret(args.secret);
    const [queued, playing] = await Promise.all([
      ctx.db.query("prompts").withIndex("by_status_created", (q) => q.eq("status", "queued")).collect(),
      ctx.db.query("prompts").withIndex("by_status_created", (q) => q.eq("status", "playing")).collect(),
    ]);
    await Promise.all(
      [...queued, ...playing]
        .map((row) => ctx.db.patch(row._id, { status: "pending", queuedAt: undefined, startedAt: undefined })),
    );
  },
});

async function blockPrompt(ctx: MutationCtx, id: Id<"prompts">) {
  const row = await ctx.db.get(id);
  if (!row || row.status === "blocked") return;
  await ctx.db.patch(id, { status: "blocked", blockedAt: Date.now(), queuedAt: undefined, startedAt: undefined });
}

// Bounded incident containment retains rows as evidence and never scans history.
export const quarantineUnsafe = internalMutation({
  args: {},
  handler: async ctx => {
    let inspected = 0, blocked = 0;
    for (const status of ACTIVE_PROMPT_STATUSES) {
      const rows = await ctx.db.query("prompts").withIndex("by_status_created", q => q.eq("status", status)).take(500);
      for (const row of rows) {
        inspected++;
        if (hasUnsafePromptEncoding(row.text) || hasUnsafePromptEncoding(row.author)) {
          await blockPrompt(ctx, row._id);
          blocked++;
        }
      }
    }
    return { inspected, blocked };
  },
});

export const sceneSource = internalQuery({
  args: { id: v.id("prompts") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    return row?.status === "queued" ? { text: row.text, author: row.author } : null;
  },
});

export const finishSceneCheck = internalMutation({
  args: { id: v.optional(v.id("prompts")), revision: v.number(), rejected: v.boolean() },
  handler: async (ctx, { id, revision, rejected }) => {
    const policy = await readPromptModeration(ctx);
    if (policy.revision !== revision) return false;
    if (!id) return true;
    const row = await ctx.db.get(id);
    if (!row || row.status !== "queued") return false;
    if (rejected) await blockPrompt(ctx, id);
    return true;
  },
});

// Check the exact compiled scene, including automatic continuations, before enqueue.
export const checkScene = action({
  args: { secret: v.string(), promptId: v.optional(v.id("prompts")), direction: v.string(), scene: v.string() },
  handler: async (ctx, args): Promise<ModerationResult> => {
    requireBroadcasterSecret(args.secret);
    const unavailable: ModerationResult = { status: "unavailable", reason: "Scene safety check unavailable." };
    if (!args.scene.trim() || args.scene.length > 800 || args.direction.length > 800) return unavailable;
    const source = args.promptId ? await ctx.runQuery(internal.prompts.sceneSource, { id: args.promptId }) : { text: args.direction, author: "Reactor" };
    if (!source) return unavailable;
    const policy = await ctx.runQuery(internal.prompts.getModerationSettings, {});
    const result = await moderatePrompt({ ...source, renderedScene: args.scene, additionalCriteria: policy.criteria }, process.env.OPENAI_API_KEY);
    if (result.status === "unavailable") return result;
    const current = await ctx.runMutation(internal.prompts.finishSceneCheck, {
      id: args.promptId, revision: policy.revision, rejected: result.status === "rejected",
    });
    return current ? result : unavailable;
  },
});

export const claim = mutation({
  args: { secret: v.string(), priorityOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    requireBroadcasterSecret(args.secret);
    for (let attempt = 0; attempt < 16; attempt++) {
      const immediate = await ctx.db
        .query("prompts")
        .withIndex("by_status_play_now_created", (q) => q.eq("status", "pending").eq("playNow", true))
        .first();
      const prompt = immediate ?? (args.priorityOnly ? null : await ctx.db
        .query("prompts")
        .withIndex("by_status_created", (q) => q.eq("status", "pending"))
        .first());
      if (!prompt) return null;
      if (hasUnsafePromptEncoding(prompt.text) || hasUnsafePromptEncoding(prompt.author)) {
        await blockPrompt(ctx, prompt._id);
        continue;
      }
      await ctx.db.patch(prompt._id, { status: "queued", queuedAt: Date.now() });
      return {
        ...prompt,
        openingFrameUrl: prompt.openingFrameId ? await ctx.storage.getUrl(prompt.openingFrameId) : null,
      };
    }
    return null;
  },
});

export const createOpeningFrameUpload = mutation({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requireBroadcasterSecret(args.secret);
    return await ctx.storage.generateUploadUrl();
  },
});

export const deleteOpeningFrame = mutation({
  args: { secret: v.string(), id: v.id("_storage") },
  handler: async (ctx, args) => {
    requireBroadcasterSecret(args.secret);
    await ctx.storage.delete(args.id);
  },
});

async function finishPrompt(ctx: MutationCtx, id: Id<"prompts">) {
  const prompt = await ctx.db.get(id);
  if (!prompt || prompt.status === "played" || prompt.status === "blocked") return;
  await ctx.db.patch(id, { status: "played", finishedAt: Date.now(), openingFrameId: undefined });
  if (prompt.openingFrameId) await ctx.storage.delete(prompt.openingFrameId);
}

export const markPlaying = mutation({
  args: { secret: v.string(), id: v.optional(v.id("prompts")) },
  handler: async (ctx, args) => {
    requireBroadcasterSecret(args.secret);
    const current = args.id ? await ctx.db.get(args.id) : null;
    if (args.id && (!current || current.status === "played" || current.status === "blocked")) return;
    // A confirmed new chunk supersedes every other playing prompt, even if its finish event was lost.
    const playing = await ctx.db.query("prompts")
      .withIndex("by_status_created", q => q.eq("status", "playing")).collect();
    for (const prompt of playing) if (prompt._id !== args.id) await finishPrompt(ctx, prompt._id);
    if (!args.id) return;
    if (current && current.status !== "playing") {
      await ctx.db.patch(args.id, { status: "playing", startedAt: Date.now() });
    }
  },
});

export const release = mutation({
  args: { secret: v.string(), id: v.id("prompts") },
  handler: async (ctx, args) => {
    requireBroadcasterSecret(args.secret);
    const prompt = await ctx.db.get(args.id);
    if (prompt?.status === "queued") {
      await ctx.db.patch(args.id, { status: "pending", queuedAt: undefined });
    }
  },
});

export const markPlayed = mutation({
  args: { secret: v.string(), id: v.id("prompts") },
  handler: async (ctx, args) => {
    requireBroadcasterSecret(args.secret);
    await finishPrompt(ctx, args.id);
  },
});
