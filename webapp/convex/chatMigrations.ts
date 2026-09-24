import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { awardPromptStar } from "./lib/chatSocial";

// Run each bounded page with the returned cursor. Safe to replay alongside live admissions.
export const backfillStars = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db.query("prompts").paginate({ cursor, numItems: 100 });
    let awarded = 0;
    for (const prompt of result.page) if (await awardPromptStar(ctx, prompt._id)) awarded++;
    return { cursor: result.continueCursor, done: result.isDone, awarded };
  },
});

export const backfillNames = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db.query("viewers").paginate({ cursor, numItems: 100 });
    for (const viewer of result.page) {
      if (viewer.nameLower !== viewer.name.toLowerCase()) await ctx.db.patch(viewer._id, { nameLower: viewer.name.toLowerCase() });
    }
    return { cursor: result.continueCursor, done: result.isDone };
  },
});
