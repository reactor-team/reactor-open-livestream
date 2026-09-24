import type { QueueTiming, TimedClip } from "@reactor/infinite-contracts";

type Sent = { promptId?: string; seconds: number; enqueuedAt: number };
type ClipEvent = { type: string; seconds?: number };
const duration = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 30;

/** Observes the existing bridge; never controls queue order or playback. */
export class PromptTimingTracker {
  private clips = new Map<string, TimedClip>();
  private sent = new Map<string, Sent>();
  private early = new Map<string, { event: ClipEvent; at: number }[]>();
  private generationRates: number[] = [];
  private planningSeconds: number[] = [];
  private planning: QueueTiming["planning"];
  constructor(private clock: () => number = Date.now) {}

  beginPlanning(promptId: string | null, seconds: number) {
    this.planning = { ...(promptId ? { promptId } : {}), startedAt: this.clock(), seconds };
  }
  planned() {
    if (!this.planning) return;
    this.sample(this.planningSeconds, (this.clock() - this.planning.startedAt) / 1000);
  }
  planningFailed() { this.planning = undefined; }

  observe(event: string, id: string, value: unknown) {
    if (!value || typeof value !== "object") return;
    const data = value as Record<string, unknown>;
    if (event === "sent") {
      if (!duration(data.seconds)) return;
      let promptId: string | undefined;
      try {
        const metadata: unknown = JSON.parse(String(data.metadata));
        if (metadata && typeof metadata === "object" && "id" in metadata && typeof metadata.id === "string") promptId = metadata.id;
      } catch { /* Malformed metadata has no viewer timing association. */ }
      this.sent.set(id, { ...(promptId ? { promptId } : {}), seconds: data.seconds, enqueuedAt: this.clock() });
      if (this.sent.size > 12) this.sent.delete(this.sent.keys().next().value!);
    } else if (event === "accepted") {
      const sent = this.sent.get(id);
      this.sent.delete(id);
      if (!sent || typeof data.clip_id !== "string") return;
      const clip: TimedClip = { ...sent, clipId: data.clip_id, seconds: duration(data.seconds) ? data.seconds : sent.seconds };
      if (![...this.clips.values()].some(entry => entry.generatedAt === undefined && entry.startedAt === undefined)) clip.generationStartedAt = sent.enqueuedAt;
      this.clips.set(clip.clipId, clip);
      if (this.clips.size > 6) this.clips.delete(this.clips.keys().next().value!);
      this.planning = undefined;
      for (const early of this.early.get(clip.clipId) ?? []) this.clipEvent(clip.clipId, early.event, early.at);
      this.early.delete(clip.clipId);
    } else if (event === "state" && typeof data.type === "string") {
      const message = { type: data.type, ...(duration(data.seconds) ? { seconds: data.seconds } : {}) };
      if (this.clips.has(id)) this.clipEvent(id, message, this.clock());
      else {
        const events = this.early.get(id) ?? [];
        events.push({ event: message, at: this.clock() });
        this.early.set(id, events.slice(-8));
        if (this.early.size > 12) this.early.delete(this.early.keys().next().value!);
      }
    }
  }

  private sample(samples: number[], value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
    samples.push(value);
    if (samples.length > 12) samples.shift();
  }
  private clipEvent(id: string, event: ClipEvent, at: number) {
    const clip = this.clips.get(id);
    if (!clip) return;
    if (event.seconds) clip.seconds = event.seconds;
    if (event.type === "clip_generated" && clip.generatedAt === undefined) {
      clip.generatedAt = at;
      if (clip.generationStartedAt !== undefined) this.sample(this.generationRates, (at - clip.generationStartedAt) / (1000 * clip.seconds));
      const next = [...this.clips.values()].find(entry => entry.generatedAt === undefined && entry.startedAt === undefined);
      if (next) next.generationStartedAt = at;
    }
    if (event.type === "clip_started") {
      clip.startedAt ??= at;
      clip.generatedAt ??= at;
    }
    if (["clip_finished", "clip_stopped", "clip_popped", "clip_failed"].includes(event.type)) this.clips.delete(id);
  }

  snapshot(): QueueTiming {
    return {
      observedAt: this.clock(), clips: [...this.clips.values()].map(clip => ({ ...clip })),
      ...(this.planning ? { planning: { ...this.planning } } : {}),
      generationRates: [...this.generationRates], planningSeconds: [...this.planningSeconds],
    };
  }
}
