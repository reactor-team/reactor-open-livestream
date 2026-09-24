import {
  DEFAULT_BROADCAST_SETTINGS,
  type BroadcastSettings,
  type QueueTiming,
  type BroadcastStatus,
  type TableSnapshot,
  type ScheduledSegment,
  type SegmentRun,
} from "@reactor/infinite-contracts";
import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";

import type { BroadcasterConfig } from "./config";

export type ClaimedPrompt = {
  chunkSeconds?: number;
  _id: string;
  text: string;
  author: string;
  continuityNotes?: string;
  voicePrompt?: string;
  openingFrameUrl?: string | null;
  startsSegment?: boolean;
  continuous?: boolean;
  playNow?: boolean;
  interactionRunId?: string;
};

export class BroadcastStore {
  readonly #client: ConvexClient | null;
  readonly #secret: string | null;

  constructor(config: BroadcasterConfig) {
    this.#client = config.CONVEX_URL ? new ConvexClient(config.CONVEX_URL) : null;
    this.#secret = config.BROADCASTER_SECRET ?? null;
  }

  async resetInFlight(): Promise<void> {
    if (!this.#client || !this.#secret) return;
    await this.#client.mutation(anyApi.prompts.resetInFlight, { secret: this.#secret });
    await this.#client.mutation(anyApi.voting.reset, { secret: this.#secret });
  }

  async getSettings(): Promise<BroadcastSettings> {
    if (!this.#client) return { ...DEFAULT_BROADCAST_SETTINGS };
    return await this.#client.query(anyApi.settings.get, {});
  }

  async voting(operation: "planning" | "accepted" | "playback" | "release" | "discard", input: Record<string, unknown>) {
    if (!this.#client || !this.#secret) return { prepare: false, winner: null };
    return this.#client.mutation(anyApi.voting[operation], { secret: this.#secret, ...input });
  }

  async getSchedule(): Promise<ScheduledSegment[]> {
    if (!this.#client || !this.#secret) return [];
    return await this.#client.query(anyApi.schedule.list, { secret: this.#secret });
  }

  async claimPrompt(priorityOnly = false): Promise<ClaimedPrompt | null> {
    if (!this.#client || !this.#secret) return null;
    return await this.#client.mutation(anyApi.prompts.claim, { secret: this.#secret, priorityOnly });
  }

  async checkScene(scene: string, direction: string, promptId: string | null): Promise<"allowed" | "rejected" | "unavailable"> {
    if (!this.#client || !this.#secret) return "unavailable";
    const result = await this.#client.action(anyApi.prompts.checkScene, {
      secret: this.#secret, scene, direction, promptId: promptId ?? undefined,
    }) as { status?: string };
    return result.status === "allowed" || result.status === "rejected" ? result.status : "unavailable";
  }

  async tableSnapshot(id: string): Promise<TableSnapshot> {
    if (!this.#client) throw new Error("Interactive scenes need Convex");
    return await this.#client.query(anyApi.table.snapshot, { id });
  }

  async markPlaying(id: string | null): Promise<void> {
    if (!this.#client || !this.#secret) return;
    await this.#client.mutation(anyApi.prompts.markPlaying, { secret: this.#secret, id: id ?? undefined });
  }

  async releasePrompt(id: string): Promise<void> {
    if (!this.#client || !this.#secret) return;
    await this.#client.mutation(anyApi.prompts.release, { secret: this.#secret, id });
  }

  async markPlayed(id: string): Promise<void> {
    if (!this.#client || !this.#secret) return;
    await this.#client.mutation(anyApi.prompts.markPlayed, { secret: this.#secret, id });
  }

  async updateQueueTiming(sessionStartedAt: number, timing: QueueTiming): Promise<void> {
    if (!this.#client || !this.#secret) return;
    await this.#client.mutation(anyApi.broadcast.updateQueueTiming, { secret: this.#secret, sessionStartedAt, timing });
  }

  async heartbeat(input: {
    status: BroadcastStatus;
    detail?: string;
    currentPrompt?: string;
    currentAuthor?: string;
    currentChunkStartedAt?: number;
    currentSegmentStartedAt?: number;
    continuous?: boolean;
    segment?: SegmentRun;
    table?: TableSnapshot;
    startedAt?: number;
  }): Promise<void> {
    if (!this.#client || !this.#secret) return;
    await this.#client.mutation(anyApi.broadcast.heartbeat, { secret: this.#secret, ...input });
  }

  async reportMediaHealth(sessionStartedAt: number, observedAt: number, healthy: boolean): Promise<void> {
    if (!this.#client || !this.#secret) return;
    await this.#client.mutation(anyApi.streamAlerts.pulse, {
      secret: this.#secret, sessionStartedAt, observedAt, healthy,
    });
  }

  async close(): Promise<void> {
    await this.#client?.close();
  }
}
