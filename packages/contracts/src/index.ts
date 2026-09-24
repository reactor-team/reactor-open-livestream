import type { ChatMessageType } from "./chat-notices.ts";
import { DEFAULT_FAKE_VIEWERS } from "./viewer-count.ts";
export * from "./chat-notices.ts";
export * from "./chat-social.ts";
export * from "./prompt-timing.ts";
export * from "./prompt-queue.ts";
export * from "./viewer-name.ts";
export * from "./viewer-count.ts";
export * from "./broadcast-message.ts";
export * from "./prompt-safety.ts";

export const BROADCAST_KEY = "main" as const;
export const DEFAULT_LIVEKIT_ROOM = "reactor-tv";
export const DEFAULT_DEV_LIVEKIT_ROOM = "reactor-tv-dev";
export const MAX_PROMPT_LENGTH = 800;
export const MAX_AUTHOR_LENGTH = 24;
export const MAX_CHAT_LENGTH = 400;

export const DEFAULT_BROADCAST_SETTINGS = {
  chunkSeconds: 10,
  banner: "",
  interactionMode: "prompts",
  voteDurationChunks: 2,
  num_fake_viewers: DEFAULT_FAKE_VIEWERS,
  enabledChatMessageTypes: [] as ChatMessageType[],
} as const;


export type BroadcastStatus =
  | "offline"
  | "starting"
  | "live"
  | "degraded";

export type PromptStatus = "pending" | "queued" | "playing" | "played" | "blocked";

export type BroadcastSettings = {
  chunkSeconds: number;
  banner: string;
  interactionMode: "prompts" | "voting";
  voteDurationChunks: number;
  num_fake_viewers: number;
  enabledChatMessageTypes: readonly ChatMessageType[];
};

export type VoteOption = { label: string; direction: string };
export type PublicVoteRound = {
  _id: string; segmentTitle: string; status: string; durationChunks: number; completedChunks: number;
  options: { label: string; votes: number }[]; winnerIndex?: number;
};
export type PublicVoting = { enabled: boolean; round: PublicVoteRound | null; lastWinner: PublicVoteRound | null; choice: number | null };

export type ScheduledSegment = {
  chunkSeconds?: number;
  segmentId?: string;
  openingFrameUrl?: string | null;
  _id: string;
  title: string;
  text: string;
  continuityNotes: string;
  voicePrompt: string;
  durationSeconds: number;
  position: number;
  enabled: boolean;
};

export type SegmentRun = { runId?: string; chunkSeconds?: number; id?: string; title: string; durationSeconds: number };
export type ScheduleCursor = SegmentRun & { elapsedSeconds: number };

export type RuntimeBroadcastState = {
  status: BroadcastStatus;
  detail?: string;
  currentPrompt?: string;
  currentAuthor?: string;
  currentChunkStartedAt?: number;
  currentSegmentStartedAt?: number;
  continuous?: boolean;
  segment?: SegmentRun;
  heartbeatAt?: number;
  startedAt?: number;
};
export * from "./peace-talks.ts";
