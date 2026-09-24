export const CHAT_PROMPT_PREVIEW_LENGTH = 100;
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

export function chatPromptPreview(text: string): { text: string; truncated: boolean } {
  const normalized = text.replace(/\s+/gu, " ").trim();
  const characters = Array.from(graphemes.segment(normalized), part => part.segment);
  if (characters.length <= CHAT_PROMPT_PREVIEW_LENGTH) return { text, truncated: false };
  const prefix = characters.slice(0, CHAT_PROMPT_PREVIEW_LENGTH).join("");
  const lastSpace = prefix.lastIndexOf(" ");
  const end = lastSpace >= prefix.length * 0.75 ? prefix.slice(0, lastSpace) : prefix;
  return { text: end.trimEnd() + "…", truncated: true };
}
