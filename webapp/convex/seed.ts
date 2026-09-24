import { internalMutation } from "./_generated/server";
import { OFFICE_SEED_KEY, officeSeed } from "./lib/officeSeed";

// Explicit CLI operation, never a public mutation or startup hook.
export const office = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("segments")
      .withIndex("by_client_key", q => q.eq("clientKey", OFFICE_SEED_KEY)).unique();
    if (existing) return { created: false, segmentId: existing._id };
    const now = Date.now();
    const segmentId = await ctx.db.insert("segments", {
      ...officeSeed, clientKey: OFFICE_SEED_KEY, savedAt: now,
    });
    const last = await ctx.db.query("scheduleEntries").withIndex("by_position").order("desc").first();
    await ctx.db.insert("scheduleEntries", {
      segmentId, durationSeconds: 300, enabled: true,
      position: (last?.position ?? 0) + 1, updatedAt: now,
    });
    return { created: true, segmentId };
  },
});

export const removeOffice = internalMutation({
  args: {},
  handler: async (ctx) => {
    const segment = await ctx.db.query("segments")
      .withIndex("by_client_key", q => q.eq("clientKey", OFFICE_SEED_KEY)).unique();
    if (!segment) return { removed: false };
    const entries = await ctx.db.query("scheduleEntries").collect();
    for (const entry of entries) {
      if (entry.segmentId === segment._id) await ctx.db.delete(entry._id);
    }
    await ctx.db.delete(segment._id);
    return { removed: true };
  },
});
