import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireBroadcasterSecret } from "./lib";

async function joined(ctx: QueryCtx) {
  const entries = await ctx.db.query("scheduleEntries").withIndex("by_position").collect();
  return (await Promise.all(entries.map(async entry => {
    const segment = await ctx.db.get(entry.segmentId);
    if (!segment) return null;
    return { ...entry, title: segment.title, chunkSeconds: segment.chunkSeconds, text: segment.direction,
      continuityNotes: segment.continuity, voicePrompt: segment.voicePrompt,
      enabled: entry.enabled && Boolean(segment.direction.trim()),
      openingFrameUrl: segment.openingFrame ? await ctx.storage.getUrl(segment.openingFrame.storageId) : null };
  }))).filter(entry => entry !== null);
}
export const list = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => { requireBroadcasterSecret(secret); return joined(ctx); },
});
export const rundown = query({
  args: {},
  handler: async ctx => (await joined(ctx)).filter(row => row.enabled)
    .map(({ _id, title, durationSeconds }) => ({ _id, title, durationSeconds })),
});
export const edit = mutation({
  args: { secret: v.string(), operation: v.union(v.literal("add"), v.literal("update"), v.literal("up"), v.literal("down"), v.literal("remove")),
    id: v.optional(v.id("scheduleEntries")), segmentId: v.optional(v.id("segments")),
    durationSeconds: v.optional(v.number()), enabled: v.optional(v.boolean()) },
  handler: async (ctx, { secret, operation, id, segmentId, durationSeconds, enabled }) => {
    requireBroadcasterSecret(secret);
    if (durationSeconds !== undefined && (!Number.isInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 3600)) throw new Error("Duration must be 30 to 3600 seconds");
    const rows = await ctx.db.query("scheduleEntries").withIndex("by_position").collect();
    const updatedAt = Date.now();
    if (operation === "add") {
      const segment = segmentId ? await ctx.db.get(segmentId) : null;
      if (!segment || !segment.direction.trim()) throw new Error("Save a starting prompt before scheduling this segment");
      return await ctx.db.insert("scheduleEntries", { segmentId: segment._id, durationSeconds: durationSeconds ?? 300, enabled: true, position: (rows.at(-1)?.position ?? 0) + 1, updatedAt });
    }
    const index = rows.findIndex(row => row._id === id);
    if (index < 0 || !id) throw new Error("Schedule entry no longer exists");
    if (operation === "remove") { await ctx.db.delete(id); return; }
    if (operation === "update") {
      if (enabled) {
        const segment = await ctx.db.get(rows[index].segmentId);
        if (!segment?.direction.trim()) throw new Error("This segment needs a starting prompt");
      }
      await ctx.db.patch(id, { ...(durationSeconds !== undefined ? { durationSeconds } : {}), ...(enabled !== undefined ? { enabled } : {}), updatedAt });
      return;
    }
    const destination = index + (operation === "up" ? -1 : 1);
    if (destination < 0 || destination >= rows.length) return;
    [rows[index], rows[destination]] = [rows[destination], rows[index]];
    for (let i = 0; i < rows.length; i++) await ctx.db.patch(rows[i]._id, { position: i + 1, updatedAt });
  },
});

// Preserve legacy rows as a recovery source. Safe to run repeatedly.
export const migrateLegacy = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    requireBroadcasterSecret(secret);
    let imported = 0;
    for (const row of await ctx.db.query("scheduledSegments").withIndex("by_position").collect()) {
      if (await ctx.db.query("scheduleEntries").withIndex("by_legacy", q => q.eq("legacyId", row._id)).unique()) continue;
      if (await ctx.db.query("segments").withIndex("by_client_key", q => q.eq("clientKey", row._id)).unique()) continue;
      const segmentId = await ctx.db.insert("segments", { clientKey: row._id, title: row.title, direction: row.text,
        continuity: row.continuityNotes, voicePrompt: row.voicePrompt, experience: "", imageAnalysis: "", generationModel: "", savedAt: row.updatedAt });
      await ctx.db.insert("scheduleEntries", { segmentId, durationSeconds: row.durationSeconds, enabled: row.enabled, position: row.position, legacyId: row._id, updatedAt: Date.now() });
      imported++;
    }
    return { imported };
  },
});
