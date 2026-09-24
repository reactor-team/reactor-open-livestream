import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { queueTiming } from "./lib/queueTiming";
import { delivery } from "./lib/streamAlerts";

export default defineSchema({
  streamMonitor: defineTable({
    key: v.literal("main"), enabled: v.boolean(), epoch: v.number(), armedAt: v.number(),
    lastHealthyAt: v.optional(v.number()), lastPulseAt: v.optional(v.number()),
    sessionStartedAt: v.optional(v.number()), observedAt: v.optional(v.number()),
    healthySince: v.optional(v.number()), incidentId: v.optional(v.id("streamOutages")),
    nextCheckAt: v.optional(v.number()),
  }).index("by_key", ["key"]),
  streamOutages: defineTable({
    epoch: v.number(), startedAt: v.number(), detectedAt: v.number(), recoveredAt: v.optional(v.number()),
    down: delivery, recovery: v.optional(delivery),
  }).index("by_detected", ["detectedAt"]),
  viewers: defineTable({ identity: v.string(), name: v.string(), nameLower: v.optional(v.string()), createdAt: v.number(), nameChangedAt: v.optional(v.number()) })
    .index("by_identity", ["identity"]).index("by_name", ["nameLower"]),
  viewerStars: defineTable({ identity: v.string(), count: v.number() }).index("by_identity", ["identity"]),
  messageReactions: defineTable({ messageId: v.id("messages"), identity: v.string(), key: v.string() })
    .index("by_message_identity_key", ["messageId", "identity", "key"]),
  voteState: defineTable({ key: v.literal("main"), runId: v.optional(v.string()), currentClipId: v.optional(v.string()),
    activeRoundId: v.optional(v.id("voteRounds")), lastWinnerId: v.optional(v.id("voteRounds")) }).index("by_key", ["key"]),
  voteRounds: defineTable({
    runId: v.string(), segmentTitle: v.string(), anchorClipId: v.string(),
    options: v.array(v.object({ label: v.string(), direction: v.string(), votes: v.number() })),
    durationChunks: v.number(), completedChunks: v.number(),
    status: v.union(v.literal("prepared"), v.literal("open"), v.literal("closed"), v.literal("claimed"), v.literal("queued"), v.literal("playing"), v.literal("cancelled")),
    winnerIndex: v.optional(v.number()), createdAt: v.number(), openedAt: v.optional(v.number()), closedAt: v.optional(v.number()),
  }).index("by_run", ["runId"]).index("by_status", ["status"]).index("by_anchor", ["anchorClipId"]),
  ballots: defineTable({ roundId: v.id("voteRounds"), identity: v.string(), option: v.number() }).index("by_round_identity", ["roundId", "identity"]),
  voteClips: defineTable({ clipId: v.string(), runId: v.string(), roundToOpenId: v.optional(v.id("voteRounds")),
    winnerRoundId: v.optional(v.id("voteRounds")), startedAt: v.optional(v.number()), finishedAt: v.optional(v.number()) }).index("by_clip", ["clipId"]),
  segments: defineTable({
    chunkSeconds: v.optional(v.number()),
    clientKey: v.string(), title: v.string(), direction: v.string(), continuity: v.string(), voicePrompt: v.string(),
    experience: v.string(), imageAnalysis: v.string(), generationModel: v.string(), savedAt: v.number(),
    openingFrame: v.optional(v.object({ storageId: v.id("_storage"), name: v.string(), bytes: v.number(), width: v.number(), height: v.number() })),
  }).index("by_client_key", ["clientKey"]),
  scheduleEntries: defineTable({
    segmentId: v.id("segments"), durationSeconds: v.number(), position: v.number(), enabled: v.boolean(),
    legacyId: v.optional(v.id("scheduledSegments")), updatedAt: v.number(),
  }).index("by_position", ["position"]).index("by_legacy", ["legacyId"]),
  scheduledSegments: defineTable({
    title: v.string(), text: v.string(), continuityNotes: v.string(), voicePrompt: v.string(),
    durationSeconds: v.number(), position: v.number(), enabled: v.boolean(), updatedAt: v.number(),
  }).index("by_position", ["position"]),
  broadcasts: defineTable({
    queueTiming: v.optional(queueTiming),
    key: v.literal("main"),
    status: v.union(
      v.literal("offline"),
      v.literal("starting"),
      v.literal("live"),
      v.literal("degraded"),
    ),
    detail: v.optional(v.string()),
    currentPrompt: v.optional(v.string()),
    currentAuthor: v.optional(v.string()),
    currentChunkStartedAt: v.optional(v.number()),
    currentSegmentStartedAt: v.optional(v.number()),
    continuous: v.optional(v.boolean()),
    segment: v.optional(v.object({ chunkSeconds: v.optional(v.number()), id: v.optional(v.string()), title: v.string(), durationSeconds: v.number() })),
    table: v.optional(v.object({ runId: v.string(), lengthCm: v.number(), revision: v.number() })),
    heartbeatAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
  }).index("by_key", ["key"]),

  settings: defineTable({
    key: v.literal("main"),
    interactionMode: v.optional(v.union(v.literal("prompts"), v.literal("voting"))),
    voteDurationChunks: v.optional(v.number()),
    num_fake_viewers: v.optional(v.number()),
    chunkSeconds: v.number(),
    banner: v.string(),
    enabledChatMessageTypes: v.optional(v.array(v.string())),
    promptModerationCriteria: v.optional(v.array(v.string())),
    promptModerationRevision: v.optional(v.number()),
    // Retained only to accept existing rows; runtime settings ignore it.
    programDurationMinutes: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  prompts: defineTable({
    blockedAt: v.optional(v.number()),
    starAwarded: v.optional(v.boolean()),
    text: v.string(),
    author: v.string(),
    identity: v.string(),
    openingFrameId: v.optional(v.id("_storage")),
    chunkSeconds: v.optional(v.number()),
    startsSegment: v.optional(v.boolean()),
    continuous: v.optional(v.boolean()),
    continuityNotes: v.optional(v.string()),
    voicePrompt: v.optional(v.string()),
    playNow: v.optional(v.boolean()),
    interactionRunId: v.optional(v.id("tableRuns")),
    status: v.union(
      v.literal("pending"),
      v.literal("queued"),
      v.literal("playing"),
      v.literal("played"),
      v.literal("blocked"),
    ),
    createdAt: v.number(),
    queuedAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index("by_status_created", ["status", "createdAt"])
    .index("by_status_play_now_created", ["status", "playNow", "createdAt"])
    .index("by_identity_status", ["identity", "status"]),

  tableRuns: defineTable({
    lengthCm: v.number(),
    revision: v.number(),
    createdAt: v.number(),
  }),

  messages: defineTable({
    reactionCounts: v.optional(v.record(v.string(), v.number())),
    mentions: v.optional(v.array(v.object({ name: v.string(), identity: v.string() }))),
    systemKind: v.optional(v.string()),
    roundId: v.optional(v.id("voteRounds")),
    body: v.string(),
    author: v.string(),
    identity: v.string(),
    promptId: v.optional(v.id("prompts")),
    createdAt: v.number(),
  }).index("by_created", ["createdAt"])
    .index("by_identity_created", ["identity", "createdAt"])
    .index("by_system_kind_created", ["systemKind", "createdAt"]),
});
