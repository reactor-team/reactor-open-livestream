import { v } from "convex/values";
import { action } from "./_generated/server";
import { requireBroadcasterSecret } from "./lib";
import { enrichSegmentInput } from "./lib/segmentEnrichment";

type EnrichmentResult = { status: number; data: { value?: string; model?: string; error?: string } };

// The authenticated Next.js Admin route is the caller. Browser-supplied keys are not accepted.
export const enrich = action({
  args: {
    secret: v.string(),
    input: v.object({
      field: v.union(v.literal("title"), v.literal("experience"), v.literal("imageAnalysis"), v.literal("startingPrompt"), v.literal("continuityNotes"), v.literal("voicePrompt")),
      title: v.optional(v.string()), experience: v.optional(v.string()), imageAnalysis: v.optional(v.string()),
      startingPrompt: v.optional(v.string()), continuityNotes: v.optional(v.string()), voicePrompt: v.optional(v.string()),
      changeRequest: v.optional(v.string()), imageDataUrl: v.optional(v.string()), chunkSeconds: v.optional(v.number()),
    }),
  },
  handler: async (_ctx, { secret, input }): Promise<EnrichmentResult> => {
    requireBroadcasterSecret(secret);
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key || key.length > 512) return { status: 503, data: { error: "Admin AI is not configured. Set OPENAI_API_KEY in this Convex deployment's environment variables." } };
    const response = await enrichSegmentInput(input, key);
    return { status: response.status, data: await response.json() as EnrichmentResult["data"] };
  },
});
