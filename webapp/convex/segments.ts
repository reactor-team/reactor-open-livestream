import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireBroadcasterSecret } from "./lib";

export const list = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    requireBroadcasterSecret(secret);
    const rows = await ctx.db.query("segments").collect();
    return await Promise.all(rows.sort((a, b) => b.savedAt - a.savedAt).map(async row => ({
      id: row._id, chunkSeconds: row.chunkSeconds, title: row.title, direction: row.direction, continuity: row.continuity, voicePrompt: row.voicePrompt,
      experience: row.experience, imageAnalysis: row.imageAnalysis, generationModel: row.generationModel, savedAt: row.savedAt,
      openingFrame: row.openingFrame ? { ...row.openingFrame, dataUrl: await ctx.storage.getUrl(row.openingFrame.storageId) } : undefined,
    })));
  },
});

export const save = mutation({
  args: {
    secret: v.string(), chunkSeconds: v.optional(v.union(v.number(), v.null())), id: v.optional(v.id("segments")), clientKey: v.string(),
    title: v.string(), direction: v.string(), continuity: v.string(), voicePrompt: v.string(),
    experience: v.string(), imageAnalysis: v.string(), generationModel: v.string(),
    openingFrame: v.optional(v.union(v.null(), v.object({ storageId: v.id("_storage"), name: v.string(), bytes: v.number(), width: v.number(), height: v.number() }))),
  },
  handler: async (ctx, { secret, id, clientKey, openingFrame, chunkSeconds, ...fields }) => {
    requireBroadcasterSecret(secret);
    if (chunkSeconds != null && (!Number.isInteger(chunkSeconds) || chunkSeconds < 6 || chunkSeconds > 14)) throw new Error("Chunk length must be 6 to 14 seconds");
    const limits = { title: 100, direction: 800, continuity: 1600, voicePrompt: 360, experience: 1200, imageAnalysis: 6000, generationModel: 100 };
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
      fields[key] = fields[key].trim().replace(/[\u2013\u2014]/g, "-");
      if (fields[key].length > limits[key]) throw new Error(`${key} exceeds ${limits[key]} characters`);
    }
    if (!fields.title || !clientKey || clientKey.length > 160) throw new Error("Segment name and identity are required");
    if (openingFrame) {
      const asset = await ctx.db.system.get(openingFrame.storageId);
      if (!asset || asset.size > 5 * 1024 * 1024 || !/^image\/(jpeg|png|webp)$/.test(asset.contentType ?? "")) throw new Error("Invalid opening frame");
    }
    const existing = id ? await ctx.db.get(id) : await ctx.db.query("segments").withIndex("by_client_key", q => q.eq("clientKey", clientKey)).unique();
    if (id && !existing) throw new Error("Segment no longer exists");
    const value = { ...fields, ...(chunkSeconds !== undefined ? { chunkSeconds: chunkSeconds ?? undefined } : {}), clientKey: existing?.clientKey ?? clientKey, savedAt: Date.now(),
      ...(openingFrame !== undefined ? { openingFrame: openingFrame ?? undefined } : {}) };
    if (existing) { await ctx.db.patch(existing._id, value); return existing._id; }
    return await ctx.db.insert("segments", value);
  },
});
