import { MAX_AUTHOR_LENGTH, MAX_CHAT_LENGTH, MAX_PROMPT_LENGTH } from "@reactor/infinite-contracts";

export function cleanText(value: string, maximum: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

export function cleanAuthor(value: string): string {
  return cleanText(value, MAX_AUTHOR_LENGTH).replace(/[^a-zA-Z0-9_]/g, "");
}

export function cleanIdentity(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

export function promptText(value: string): string {
  return cleanText(value, MAX_PROMPT_LENGTH);
}

export function chatText(value: string): string {
  return cleanText(value, MAX_CHAT_LENGTH);
}

export function requireBroadcasterSecret(value: string): void {
  const expected = process.env.BROADCASTER_SECRET;
  if (!expected || value !== expected) throw new Error("Unauthorized broadcaster");
}
