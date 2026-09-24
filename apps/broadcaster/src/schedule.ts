import type { ScheduledSegment, ScheduleCursor } from "@reactor/infinite-contracts";
import type { SceneDirection } from "./story-planner";

/** Count accepted clip duration, not generation wall time, when scheduling boundaries. */
export function nextScheduledScene(entries: ScheduledSegment[], cursor?: ScheduleCursor): SceneDirection | null {
  const ordered = entries.filter(entry => entry.enabled).sort((a, b) => a.position - b.position || a._id.localeCompare(b._id));
  if (!ordered.length) return null;
  if (cursor && cursor.elapsedSeconds < cursor.durationSeconds) return null;
  const previous = ordered.findIndex(entry => entry._id === cursor?.id);
  const next = ordered[(previous + 1) % ordered.length];
  return {
    id: null, author: "Reactor", text: next.text, startsSegment: true,
    continuityNotes: next.continuityNotes, voicePrompt: next.voicePrompt,
    openingFrameUrl: next.openingFrameUrl,
    segment: { chunkSeconds: next.chunkSeconds, id: next._id, title: next.title, durationSeconds: next.durationSeconds },
  };
}

/** An explicit segment override wins; an inheriting run re-reads the global default. */
export function resolveChunkSeconds(globalSeconds: number, opening: boolean, override?: number, cursor?: ScheduleCursor): number {
  const value = opening ? override : cursor?.chunkSeconds;
  return typeof value === "number" && Number.isInteger(value) && value >= 6 && value <= 14 ? value : globalSeconds;
}
