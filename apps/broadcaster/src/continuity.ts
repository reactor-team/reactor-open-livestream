import type { PlannedScene } from "./story-planner";

export type FastH3Clip = {
  clip_id: string;
  seconds?: number;
};

export function clipFromMessageData(data: unknown): FastH3Clip | null {
  if (!data || typeof data !== "object") return null;
  const clip = (data as { clip?: unknown }).clip;
  if (!clip || typeof clip !== "object") return null;
  const clipId = (clip as { clip_id?: unknown }).clip_id;
  const seconds = (clip as { seconds?: unknown }).seconds;
  return typeof clipId === "string" && clipId ? {
    clip_id: clipId,
    ...(typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? { seconds } : {}),
  } : null;
}

export function continuityInput(
  lastQueuedClipId: string | null,
  startingFrame: unknown | null,
): Record<string, unknown> {
  if (lastQueuedClipId) return { continue_from_clip_id: lastQueuedClipId };
  if (startingFrame) return { starting_frame: startingFrame };
  return {};
}

export function enqueuePayload(
  scene: PlannedScene,
  clipSeconds: number,
  lastQueuedClipId: string | null,
  startingFrame: unknown | null,
  startsSegment = false,
): Record<string, unknown> {
  const metadata = {
    id: scene.id,
    text: scene.text,
    author: scene.author,
    startsSegment,
    ...(scene.runId ? { runId: scene.runId } : {}),
    ...(scene.segment ? { segment: scene.segment } : {}),
    ...(scene.continuous ? { continuous: true } : {}),
    ...(scene.table ? { table: scene.table } : {}),
  };
  return {
    prompt: scene.videoPrompt,
    seconds: clipSeconds,
    metadata: JSON.stringify(metadata),
    ...continuityInput(lastQueuedClipId, startingFrame),
  };
}
