import { viewerNameError, VIEWER_NAME_MISMATCH, VIEWER_NAME_REQUIRED, VIEWER_NAME_COOLDOWN_MS } from "@reactor/infinite-contracts";
import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export async function savedViewerName(ctx: QueryCtx, identity: string): Promise<string | null> {
  const viewer = await ctx.db.query("viewers").withIndex("by_identity", q => q.eq("identity", identity)).unique();
  if (viewer) return viewerNameError(viewer.name) ? null : viewer.name;
  // Preserve an existing custom sender name, never an automatically assigned one.
  const latest = await ctx.db.query("messages").withIndex("by_identity_created", q => q.eq("identity", identity)).order("desc").first();
  return latest && !latest.systemKind && !viewerNameError(latest.author) ? latest.author : null;
}

export async function viewerNameSubmissionError(ctx: QueryCtx, identity: string, author: string): Promise<string | null> {
  const name = await savedViewerName(ctx, identity);
  if (!name) return VIEWER_NAME_REQUIRED;
  return author === name ? null : VIEWER_NAME_MISMATCH;
}

export async function saveViewerName(ctx: MutationCtx, identity: string, name: string): Promise<string> {
  const existing = await ctx.db.query("viewers").withIndex("by_identity", q => q.eq("identity", identity)).unique();
  const saved = await savedViewerName(ctx, identity);
  if (saved && saved !== name) throw new ConvexError(VIEWER_NAME_MISMATCH);
  if (!existing) await ctx.db.insert("viewers", { identity, name, nameLower: name.toLowerCase(), createdAt: Date.now() });
  // Generic legacy profile rows can make their one explicit choice too.
  else if (!saved) await ctx.db.patch(existing._id, { name, nameLower: name.toLowerCase(), createdAt: Date.now() });
  else if (existing.nameLower !== name.toLowerCase()) await ctx.db.patch(existing._id, { nameLower: name.toLowerCase() });
  return name;
}

export async function viewerNameProfile(ctx: QueryCtx, identity: string) {
  const viewer = await ctx.db.query("viewers").withIndex("by_identity", q => q.eq("identity", identity)).unique();
  const name = await savedViewerName(ctx, identity);
  return { name, canChangeAt: name && viewer?.nameChangedAt !== undefined ? viewer.nameChangedAt + VIEWER_NAME_COOLDOWN_MS : 0 };
}

export async function changeViewerName(ctx: MutationCtx, identity: string, name: string): Promise<string> {
  const existing = await ctx.db.query("viewers").withIndex("by_identity", q => q.eq("identity", identity)).unique();
  const profile = await viewerNameProfile(ctx, identity);
  // Same-name retries and adoption from chat history do not consume or extend a cooldown.
  if (profile.name === name) return saveViewerName(ctx, identity, name);
  const now = Date.now();
  if (profile.name && now < profile.canChangeAt) {
    throw new ConvexError({ code: "NAME_CHANGE_COOLDOWN", canChangeAt: profile.canChangeAt });
  }
  if (existing) await ctx.db.patch(existing._id, { name, nameLower: name.toLowerCase(), nameChangedAt: now });
  else await ctx.db.insert("viewers", { identity, name, nameLower: name.toLowerCase(), createdAt: now, nameChangedAt: now });
  return name;
}
