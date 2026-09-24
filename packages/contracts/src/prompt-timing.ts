import { promptQueueLabel } from "./prompt-queue.ts";

/** Viewer-safe timing only. Prompt text and model payloads never enter telemetry. */
export type TimedClip = {
  clipId: string; promptId?: string; seconds: number; enqueuedAt: number;
  generationStartedAt?: number; generatedAt?: number; startedAt?: number;
};
export type QueueTiming = {
  observedAt: number; clips: TimedClip[];
  planning?: { promptId?: string; startedAt: number; seconds: number };
  generationRates: number[]; planningSeconds: number[];
};
export type TimingPrompt = {
  _id: string; status: string; createdAt: number; queuedAt?: number; _creationTime?: number;
  playNow?: boolean; chunkSeconds?: number;
};
export type PromptTiming = { label: string; title?: string; queuePosition?: number; queueLabel?: string };

export function orderedWaitingPrompts<T extends TimingPrompt>(prompts: T[]): T[] {
  return prompts.filter(p => p.status === "pending" || p.status === "queued")
    .sort((a, b) => Number(Boolean(b.playNow)) - Number(Boolean(a.playNow))
      || Number(b.status === "queued") - Number(a.status === "queued")
      || (a.queuedAt ?? a.createdAt) - (b.queuedAt ?? b.createdAt)
      || a.createdAt - b.createdAt
      || (a._creationTime ?? 0) - (b._creationTime ?? 0)
      || a._id.localeCompare(b._id));
}

const title = "Position among waiting viewer prompts. Buffered video may play first. Approximate time to air includes buffered clips, scripting and recent video generation speed.";
function approximateTime(low: number, high: number): string {
  const midpoint = (low + high) / 2;
  const step = midpoint < 60 ? 5 : 15;
  const seconds = Math.max(5, Math.round(midpoint / step) * step);
  if (seconds < 60) return seconds + "s";
  const remainder = seconds % 60;
  return Math.floor(seconds / 60) + "m" + (remainder ? " " + remainder + "s" : "");
}

/** Two serial lanes, generation and playback, share a three-clip capacity. */
function forecast(timing: QueueTiming, pending: TimingPrompt[], seconds: number, high: boolean): Map<string, number> {
  const factor = high ? 1.3 : 0.85;
  const rate = timing.generationRates.length >= 2
    ? (high ? Math.max(...timing.generationRates) : Math.min(...timing.generationRates)) * factor : NaN;
  const planningTime = timing.planningSeconds.length
    ? (high ? Math.max(...timing.planningSeconds) : Math.min(...timing.planningSeconds)) * factor * 1000 : NaN;
  const result = new Map<string, number>();
  let generationFree = timing.observedAt;
  let playbackFree = timing.observedAt;
  const ends: number[] = [];
  for (const clip of timing.clips) {
    let start: number;
    if (clip.startedAt !== undefined) start = clip.startedAt;
    else if (clip.generatedAt !== undefined) start = Math.max(playbackFree, clip.generatedAt);
    else {
      generationFree = (clip.generationStartedAt ?? generationFree) + clip.seconds * rate * 1000;
      start = Math.max(playbackFree, generationFree);
    }
    playbackFree = start + clip.seconds * 1000;
    ends.push(playbackFree);
    if (clip.promptId) result.set(clip.promptId, start);
  }
  let planningFree = timing.observedAt;
  const append = (promptId: string | undefined, duration: number, startedAt?: number) => {
    const slotFree = ends.length >= 3 ? ends[ends.length - 3] : timing.observedAt;
    const planStart = startedAt ?? Math.max(planningFree, slotFree);
    planningFree = planStart + planningTime;
    generationFree = Math.max(planningFree, generationFree) + duration * rate * 1000;
    const start = Math.max(playbackFree, generationFree);
    playbackFree = start + duration * 1000;
    ends.push(playbackFree);
    if (promptId) result.set(promptId, start);
  };
  if (timing.planning) append(timing.planning.promptId, timing.planning.seconds, timing.planning.startedAt);
  for (const prompt of pending) {
    if (result.has(prompt._id)) continue;
    // A claim not yet represented in telemetry must not become a second clip.
    if (prompt.status === "queued") { result.set(prompt._id, NaN); playbackFree = NaN; continue; }
    append(prompt._id, prompt.chunkSeconds ?? seconds);
  }
  return result;
}

export function promptTimings(input: {
  timing?: QueueTiming; prompts: TimingPrompt[]; now: number;
  status: string; chunkSeconds: number; voting?: boolean;
}): Map<string, PromptTiming> {
  const { timing, prompts, now, status, chunkSeconds, voting } = input;
  const waiting = orderedWaitingPrompts(prompts);
  const low = timing ? forecast(timing, waiting, chunkSeconds, false) : new Map<string, number>();
  const high = timing ? forecast(timing, waiting, chunkSeconds, true) : new Map<string, number>();
  const generationLimit = timing && timing.generationRates.length >= 2 ? Math.max(...timing.generationRates) * 1.3 : Infinity;
  const planningLimit = timing?.planningSeconds.length ? Math.max(...timing.planningSeconds) * 1.3 : Infinity;
  const stalled = timing?.clips.some(clip =>
    (clip.startedAt !== undefined && now > clip.startedAt + clip.seconds * 1000 + 4000)
    || (clip.generatedAt === undefined && clip.generationStartedAt !== undefined && now > clip.generationStartedAt + clip.seconds * generationLimit * 1000 + 4000))
    || (timing?.planning && now > timing.planning.startedAt + planningLimit * 1000 + 4000);
  const interrupted = waiting.some(prompt => prompt.playNow);
  return new Map(prompts.map(prompt => {
    let label: string;
    const clip = timing?.clips.find(entry => entry.promptId === prompt._id);
    const position = waiting.findIndex(entry => entry._id === prompt._id) + 1;
    const stage = clip?.generatedAt !== undefined ? "Buffered" : clip ? "Generating video" : prompt.status === "queued" ? "Preparing prompt" : "In queue";
    const earliest = low.get(prompt._id);
    const latest = high.get(prompt._id);
    if (prompt.status === "blocked") label = "Removed by moderation";
    else if (prompt.status === "played") label = "Aired";
    else if (prompt.status === "playing") label = "Playing now";
    else if (status === "offline") label = "Queued for next broadcast";
    else if (status !== "live") label = status === "degraded" ? "Waiting for stream to recover" : "Waiting for stream to start";
    else if (voting && prompt.status === "pending" && !prompt.playNow) label = "Saved for text mode";
    else if (!timing || !now || now - timing.observedAt > 20000 || now < timing.observedAt - 5000 || interrupted) label = stage;
    else if (stalled || (Number.isFinite(latest) && now > latest! + 4000)) label = stage + ": taking longer than expected";
    else if (!Number.isFinite(earliest) || !Number.isFinite(latest)) label = stage;
    else label = "about " + approximateTime(Math.max(0, (earliest! - now) / 1000), Math.max(0, (latest! - now) / 1000) + 3);
    const queueLabel = position > 0 ? promptQueueLabel(position) : undefined;
    if (queueLabel) label = label.startsWith("In queue") ? queueLabel + label.slice("In queue".length) : queueLabel + " · " + label;
    return [prompt._id, { label, title: position > 0 ? stage + ". " + title : title, queuePosition: position || undefined, queueLabel }];
  }));
}
