import { BROADCAST_KEY, moveTable } from "@reactor/infinite-contracts";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireBroadcasterSecret } from "./lib";

export const snapshot = query({
  args: { id: v.id("tableRuns") },
  handler: async (ctx, { id }) => {
    const run = await ctx.db.get(id);
    if (!run) throw new Error("Table scene no longer exists");
    return { runId: id, lengthCm: run.lengthCm, revision: run.revision };
  },
});

// The web server gates this prototype to local/preview environments.
// Fixed steps and a run check prevent stale tabs from changing a new scene.
export const press = mutation({
  args: { secret: v.string(), id: v.id("tableRuns"), direction: v.union(v.literal("shorten"), v.literal("lengthen")) },
  handler: async (ctx, args) => {
    requireBroadcasterSecret(args.secret);
    const broadcast = await ctx.db.query("broadcasts").withIndex("by_key", (q) => q.eq("key", BROADCAST_KEY)).unique();
    if (broadcast?.status !== "live" || broadcast.table?.runId !== args.id ||
      Date.now() - (broadcast.heartbeatAt ?? 0) > 45_000) throw new Error("This table scene is not on air");
    const run = await ctx.db.get(args.id);
    if (!run) throw new Error("Table scene no longer exists");
    const lengthCm = moveTable(run.lengthCm, args.direction);
    if (lengthCm !== run.lengthCm) await ctx.db.patch(args.id, { lengthCm, revision: run.revision + 1 });
    return lengthCm;
  },
});
