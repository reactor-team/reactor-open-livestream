import type { VoteOption } from "@reactor/infinite-contracts";

/** Choice energy comes from character behavior, not broken world continuity. */
export function voteChoiceInstruction(durationChunks: number): string {
  return [
    "Also return choices: exactly FOUR distinct audience choices for a subsequent beat in THIS segment. Every option must be a comic set-piece a viewer would actually want to see. Aim for outrageous but instantly legible, not polite improv or tiny acting notes.",
    "Each label names the character plus a strong concrete verb and recognizable target, ideally 3-7 words and at most 48 characters. A viewer should picture it instantly with the sound off. Avoid vague pronouns, internal thoughts, jargon and labels that merely say looks, nods, shifts, hesitates or explains.",
    "Offer four different visual outcomes, not four versions of handling the same prop. Cover four different kinds of trouble: a ridiculous power move, a physical gag, a harmless social disaster and a wild character-specific gambit. ALL four need a surprising visible payoff; do not include a dull safe option. Keep the cast, setting, visual style and constitution. No imported powers in a grounded show, random new characters, new format, reset, segment change or ending.",
    "Use the cast's signature traits and established props. Use bold comic mechanics such as wearing an existing prop as a crown, overcommitting to a dramatic bow, challenging an inanimate object or turning a mundane task into a mock ceremony. Adapt the mechanism to this cast and scene; never copy a stock gag or add the example's objects.",
    "Each direction expands its label into ONE achievable visible action and immediate payoff within a chunk, at most 240 characters. Keep its promise identical to the label. Continuity protects identity and space, not timidity. Heighten the character's signature obsession or flaw into visible behavior. Build on the current beat, accepted history and unresolved story; do not keep recycling the previous winning gag.",
    "Before answering, silently replace any option whose main payoff is looking, pointing, nodding, speaking, inspecting or passing a prop normally. If four still frames would look almost identical, rewrite the choices. Each label and direction must promise the SAME gag, not a funny title over a timid action.",
    `They will be voted on for ${durationChunks} played chunks, then rendered after buffered video. Choose actions that still fit after a few natural continuation beats, without requiring a split-second pose or fragile object position. Do not pre-enact an option in this clip. Choices are UI data, never words to speak or draw in the video.`,
  ].join(" ");
}

export function validateVoteOptions(value: unknown): VoteOption[] {
  if (!Array.isArray(value) || value.length !== 4) throw new Error("Return exactly four vote options");
  const options = value.map(item => {
    if (!item || typeof item.label !== "string" || typeof item.direction !== "string") throw new Error("Each vote option needs label and direction");
    const label = item.label.replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim();
    const direction = item.direction.replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim();
    if (!label || label.length > 48 || !direction || direction.length > 240) throw new Error("Vote labels must be 1-48 characters and directions 1-240 characters");
    return { label, direction };
  });
  if (new Set(options.map(o => o.label.toLowerCase())).size !== 4) throw new Error("Vote options must be distinct");
  return options;
}
