import emojiCatalog from "./emoji-catalog.json" with { type: "json" };

/** Stable keys preserve historical reactions and older clients. */
export const CHAT_REACTIONS = [
  { key: "laugh", emoji: "😂", label: "Laugh" },
  { key: "fire", emoji: "🔥", label: "Fire" },
  { key: "skull", emoji: "💀", label: "Skull" },
  { key: "clap", emoji: "👏", label: "Applause" },
  { key: "wow", emoji: "😮", label: "Wow" },
  { key: "sad", emoji: "😢", label: "Sad" },
  { key: "hundred", emoji: "💯", label: "Hundred" },
  { key: "eyes", emoji: "👀", label: "Eyes" },
] as const;
export type ReactionKey = "like" | typeof CHAT_REACTIONS[number]["key"] | `emoji:${string}`;
export const MAX_REACTIONS_PER_VIEWER = 32;
export const MAX_REACTION_TYPES = 64;
const catalog: Record<string, readonly string[]> = emojiCatalog;
export function reactionDetails(key: string): { key: ReactionKey; emoji: string; label: string } | undefined {
  const legacy = CHAT_REACTIONS.find(item => item.key === key);
  if (legacy) return legacy;
  if (!Object.hasOwn(catalog, key)) return undefined;
  const [emoji, label] = catalog[key];
  if (CHAT_REACTIONS.some(item => item.emoji === emoji.replace(/\uFE0F/g, ""))) return undefined;
  return { key: key as ReactionKey, emoji, label };
}
export function reactionKeyForEmoji(emoji: string): ReactionKey | undefined {
  if (emoji.length > 64) return undefined;
  const plain = emoji.replace(/\uFE0F/g, "");
  const legacy = CHAT_REACTIONS.find(item => item.emoji === plain);
  if (legacy) return legacy.key;
  const key = `emoji:${[...plain].map(char => char.codePointAt(0)!.toString(16)).join("-")}`;
  return Object.hasOwn(catalog, key) ? key as ReactionKey : undefined;
}
export const isReactionKey = (key: string): key is ReactionKey => key === "like" || Boolean(reactionDetails(key));
export type ChatMention = { name: string; identity: string };

// Handles exclude punctuation, email addresses and overlong partial matches.
export function mentionTokens(text: string): Array<{ name: string; start: number; end: number }> {
  return [...text.matchAll(/(?<![\w@])@([A-Za-z0-9_]{1,24})(?![A-Za-z0-9_])/g)]
    .map(match => ({ name: match[1], start: match.index!, end: match.index! + match[0].length }));
}

export function mentionAtCaret(text: string, caret: number) {
  const before = text.slice(0, caret);
  const match = before.match(/(?<![\w@])@([A-Za-z0-9_]{0,24})$/);
  if (!match) return null;
  const start = caret - match[0].length;
  const tail = text.slice(caret).match(/^[A-Za-z0-9_]*/)?.[0] ?? "";
  if (match[1].length + tail.length > 24) return null;
  return { search: match[1].toLowerCase(), start, end: caret + tail.length };
}

export function completeMention(text: string, range: { start: number; end: number }, name: string) {
  const suffix = text.slice(range.end);
  const insert = `@${name}${/^[\s.,!?:;)\]}]/.test(suffix) ? "" : " "}`;
  return { text: text.slice(0, range.start) + insert + suffix, caret: range.start + insert.length + (suffix.startsWith(" ") ? 1 : 0) };
}
