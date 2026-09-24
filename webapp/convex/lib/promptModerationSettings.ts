import type { QueryCtx } from "../_generated/server";
import { validatePromptCriteria } from "./promptModerationPolicy";

export async function readPromptModeration(ctx: Pick<QueryCtx, "db">) {
  const row = await ctx.db.query("settings").withIndex("by_key", q => q.eq("key", "main")).unique();
  return {
    criteria: validatePromptCriteria(row?.promptModerationCriteria ?? []),
    revision: row?.promptModerationRevision ?? 0,
  };
}
