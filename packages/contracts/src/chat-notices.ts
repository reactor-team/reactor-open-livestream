// Register every system chat type here. New types require explicit admin opt-in.
export const CHAT_MESSAGE_TYPES = [
  { id: "vote-open", label: "Vote opened", description: "The active ballot, its options and live counts." },
  { id: "vote-closed", label: "Vote closed", description: "The finished ballot, final counts and winning option." },
  { id: "vote-winner", label: "Winner selected", description: "The audience choice before its story beat airs." },
  { id: "vote-playing", label: "Winner on air", description: "The audience choice when its story beat starts playing." },
  { id: "vote-cancelled", label: "Round ended", description: "Legacy cancellation notices. Segment changes do not create new ones." },
] as const;

export type ChatMessageType = typeof CHAT_MESSAGE_TYPES[number]["id"];

export function normalizeChatMessageTypes(types: readonly string[] = []): ChatMessageType[] {
  return CHAT_MESSAGE_TYPES.filter(type => types.includes(type.id)).map(type => type.id);
}

// The stored ballot message follows its round from open to closed.
export function chatMessageType(kind: string, roundStatus?: string): string | null {
  if (kind !== "vote-open") return kind;
  if (roundStatus === "open") return "vote-open";
  if (["closed", "claimed", "queued", "playing"].includes(roundStatus ?? "")) return "vote-closed";
  return null;
}
