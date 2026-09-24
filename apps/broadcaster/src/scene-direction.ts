import type { ClaimedPrompt } from "./convex";
import type { SceneDirection } from "./story-planner";

/** Only submitted scenes can start a broadcast. History permits continuation. */
export function resolveSceneDirection(prompt: ClaimedPrompt | null, hasHistory: boolean): SceneDirection | null {
  if (!prompt) return hasHistory ? {
    id: null,
    text: "Continue the current segment with its next causal beat.",
    author: "Reactor",
  } : null;
  const { _id, ...direction } = prompt;
  return { ...direction, id: _id, startsSegment: prompt.startsSegment || !hasHistory,
    viewerOverride: !prompt.startsSegment && !prompt.playNow && !prompt.openingFrameUrl };
}
