import { v } from "convex/values";

export const queueTiming = v.object({
  observedAt: v.number(),
  clips: v.array(v.object({
    clipId: v.string(), promptId: v.optional(v.string()), seconds: v.number(), enqueuedAt: v.number(),
    generationStartedAt: v.optional(v.number()), generatedAt: v.optional(v.number()), startedAt: v.optional(v.number()),
  })),
  planning: v.optional(v.object({ promptId: v.optional(v.string()), startedAt: v.number(), seconds: v.number() })),
  generationRates: v.array(v.number()), planningSeconds: v.array(v.number()),
});
