import { ConvexError, v } from "convex/values";
import { viewerNameError } from "@reactor/infinite-contracts";
import { mutation, query } from "./_generated/server";
import { cleanIdentity } from "./lib";
import { viewerNameProfile, changeViewerName } from "./lib/viewerNames";

function validIdentity(identity: string): string {
  if (!identity || cleanIdentity(identity) !== identity) throw new ConvexError("Missing or invalid viewer identity.");
  return identity;
}

export const get = query({
  args: { identity: v.string() },
  handler: async (ctx, { identity }) => viewerNameProfile(ctx, validIdentity(identity)),
});

export const setName = mutation({
  args: { identity: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const identity = validIdentity(args.identity);
    const error = viewerNameError(args.name);
    if (error) throw new ConvexError(error);
    // Identity-index conflicts serialize simultaneous changes. Only one can start the hour.
    return changeViewerName(ctx, identity, args.name.trim());
  },
});

export const mentionSuggestions = query({
  args: { search: v.string() },
  handler: async (ctx, { search }) => {
    if (!/^[A-Za-z0-9_]{0,24}$/.test(search)) return [];
    const prefix = search.toLowerCase();
    const rows = await ctx.db.query("viewers").withIndex("by_name", q => q.gte("nameLower", prefix).lt("nameLower", prefix + "\uffff")).take(40);
    const seen = new Set<string>();
    return rows.filter(row => {
      const key = row.name.toLowerCase();
      if (viewerNameError(row.name) || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8).map(({ name }) => name);
  },
});
