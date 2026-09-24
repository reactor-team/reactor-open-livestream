import { mentionTokens, viewerNameError, type ChatMention } from "@reactor/infinite-contracts";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export async function awardPromptStar(ctx: MutationCtx, promptId: Id<"prompts">): Promise<boolean> {
  const prompt = await ctx.db.get(promptId);
  if (!prompt || prompt.playNow || prompt.starAwarded || !prompt.identity) return false;
  const stars = await ctx.db.query("viewerStars").withIndex("by_identity", q => q.eq("identity", prompt.identity)).unique();
  if (stars) await ctx.db.patch(stars._id, { count: stars.count + 1 });
  else await ctx.db.insert("viewerStars", { identity: prompt.identity, count: 1 });
  await ctx.db.patch(promptId, { starAwarded: true });
  return true;
}

// Resolve names on the server at admission, preserving recipients through renames.
export async function resolveMentions(ctx: QueryCtx, text: string): Promise<ChatMention[]> {
  const names = [...new Set(mentionTokens(text).map(token => token.name.toLowerCase()))].slice(0, 10);
  const results = await Promise.all(names.map(name => ctx.db.query("viewers")
    .withIndex("by_name", q => q.eq("nameLower", name)).take(8)));
  return results.flat().filter(row => !viewerNameError(row.name)).map(({ name, identity }) => ({ name, identity }));
}
