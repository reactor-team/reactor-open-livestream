import { reactionDetails, type ReactionKey } from "@reactor/infinite-contracts";

export const RECENT_EMOJI_KEY = "reactor-tv:recent-emojis:v1";
export const RECENT_EMOJI_LIMIT = 24;
export function parseRecentEmojis(value: string | null): ReactionKey[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((key): key is ReactionKey => typeof key === "string" && Boolean(reactionDetails(key))))].slice(0, RECENT_EMOJI_LIMIT);
  } catch { return []; }
}
export function addRecentEmoji(keys: readonly ReactionKey[], key: ReactionKey): ReactionKey[] {
  return reactionDetails(key) ? [key, ...keys.filter(item => item !== key)].slice(0, RECENT_EMOJI_LIMIT) : [...keys];
}
export function readRecentEmojis(): ReactionKey[] {
  try { return parseRecentEmojis(localStorage.getItem(RECENT_EMOJI_KEY)); } catch { return []; }
}
export function rememberEmoji(key: ReactionKey) {
  if (!reactionDetails(key)) return;
  try { localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(addRecentEmoji(readRecentEmojis(), key))); } catch { /* Reactions still work when storage is unavailable. */ }
}

export function emojiPopoverPosition(anchor: { left: number; top: number; bottom: number }, size: { width: number; height: number }, viewport: { width: number; height: number; left: number; top: number }) {
  const left = Math.max(viewport.left + 8, Math.min(anchor.left, viewport.left + viewport.width - size.width - 8));
  const preferredTop = anchor.top - size.height - 8 >= viewport.top + 8 ? anchor.top - size.height - 8 : anchor.bottom + 8;
  const top = Math.max(viewport.top + 8, Math.min(preferredTop, viewport.top + viewport.height - size.height - 8));
  return { left, top };
}
