/** Legacy table metadata and internal planner regression fixture, not a workshop preset. */
export const PEACE_TALKS = {
  id: "peace-talks",
  title: "Peace Talks",
  image: "/segments/peace-talks-opening.png",
  initialCm: 240,
  minCm: 140,
  maxCm: 10000,
  stepCm: 50,
  startingPrompt: "Two fictional diplomats sit at opposite ends of an ordinary 2.4-metre white marble table in a vast palace hall. Begin exactly on the supplied image. They attempt a painfully formal negotiation. Hold the normal table length until the shared length changes. Restrained gestures, awkward eye contact, dry tension, no cut.",
  continuityNotes: "Peace Talks is deadpan diplomatic theatre. Preserve the two fictional diplomats, one in black with gold embroidery and one in a plain dark suit, their chairs, the small vase, white marble tabletop and monumental hall. The authoritative shared table length is the only changing geometric variable. The table stretches or contracts along its long axis; chairs and diplomats remain at its opposite short ends. Width, human scale and the room stay fixed. Longer distances make formal conversation increasingly absurd; shorter distances create uncomfortable intimacy. No new characters, weapons, violence, scene cuts, political flags, real politicians or on-screen text. Never turn interface instructions or measurements into dialogue. Keep both ends legible with a smooth wider framing as needed, never teleport or reset. Maintain physical state between updates and invent only restrained immediate reactions, not a scheduled plot.",
  voicePrompt: "Gold-collar diplomat: low, measured British baritone, clipped formal diction. Plain-suit diplomat: dry, softly resonant mid-range voice, precise unhurried diction.",
} as const;

export type TableDirection = "shorten" | "lengthen";
export type TableSnapshot = { runId: string; lengthCm: number; revision: number };

export function moveTable(lengthCm: number, direction: TableDirection): number {
  return Math.max(PEACE_TALKS.minCm, Math.min(PEACE_TALKS.maxCm,
    lengthCm + (direction === "lengthen" ? PEACE_TALKS.stepCm : -PEACE_TALKS.stepCm)));
}

export function tableMetres(lengthCm: number): string {
  return (lengthCm / 100).toFixed(1);
}

export function tableSceneInstruction(state: TableSnapshot, opening = false): string {
  return opening
    ? `Hold the opening table at ${tableMetres(state.lengthCm)}m long, 0.9m wide; diplomats seated at opposite ends.`
    : `Table length moves smoothly to ${tableMetres(state.lengthCm)}m, or holds if unchanged. Width 0.9m; chairs follow its ends. People and room keep their scale. No cut.`;
}
