import { DEFAULT_DEV_LIVEKIT_ROOM, DEFAULT_LIVEKIT_ROOM } from "@reactor/infinite-contracts";
import { z } from "zod";


const booleanString = z
  .string()
  .optional()
  .transform((value) => value === "1" || value === "true");

const schema = z
  .object({
    CONVEX_URL: z.string().url().optional(),
    BROADCASTER_SECRET: z.string().min(16).optional(),
    BROADCASTER_MANUAL: booleanString,
    CLIP_SECONDS: z.coerce.number().min(6).max(14).default(10),
    CEREBRAS_API_KEY: z.string().min(1).optional(),
    CEREBRAS_MODEL: z.string().min(1).default("qwen-3.8-27b"),
    CEREBRAS_REASONING_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
    CEREBRAS_TIMEOUT_MS: z.coerce.number().int().min(500).max(9_000).default(5_000),
    LIVEKIT_ROOM: z.string().min(1).default(DEFAULT_LIVEKIT_ROOM),
    LIVEKIT_URL: z.string().url().optional(),
    LIVEKIT_API_KEY: z.string().min(1).optional(),
    LIVEKIT_API_SECRET: z.string().min(1).optional(),
    LIVEKIT_VIDEO_BITRATE_K: z.coerce.number().positive().default(4500),
    REACTOR_MODEL: z.string().min(1).default("reactor/fast-h3"),
    REACTOR_API_KEY: z.string().min(1).optional(),
    REACTOR_API_URL: z.string().url().default("https://api.reactor.inc"),
    REACTOR_LOCAL: booleanString,
    REACTOR_LOCAL_URL: z.string().url().default("http://localhost:8080"),
    PORT: z.coerce.number().int().positive().default(8787),
  })
  .superRefine((value, ctx) => {
    if (value.CEREBRAS_TIMEOUT_MS >= value.CLIP_SECONDS * 1_000) {
      ctx.addIssue({
        code: "custom",
        path: ["CEREBRAS_TIMEOUT_MS"],
        message: "CEREBRAS_TIMEOUT_MS must be shorter than one clip",
      });
    }
    if (value.BROADCASTER_MANUAL) return;
    for (const key of [
      "CONVEX_URL",
      "BROADCASTER_SECRET",
      "CEREBRAS_API_KEY",
      "LIVEKIT_URL",
      "LIVEKIT_API_KEY",
      "LIVEKIT_API_SECRET",
    ] as const) {
      if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required` });
    }
    if (!value.REACTOR_LOCAL && !value.REACTOR_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["REACTOR_API_KEY"], message: "REACTOR_API_KEY is required" });
    }
  });

export type BroadcasterConfig = z.infer<typeof schema>;

export function missingBridgeConfig(config: BroadcasterConfig): string[] {
  const missing = [
    "CONVEX_URL",
    "BROADCASTER_SECRET",
    "CEREBRAS_API_KEY",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
  ].filter((key) => !config[key as keyof BroadcasterConfig]);
  if (!config.REACTOR_LOCAL && !config.REACTOR_API_KEY) missing.push("REACTOR_API_KEY");
  return missing;
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): BroadcasterConfig {
  const config = schema.parse(environment);
  if (config.BROADCASTER_MANUAL && !environment.LIVEKIT_ROOM) {
    config.LIVEKIT_ROOM = DEFAULT_DEV_LIVEKIT_ROOM;
  }
  return config;
}
