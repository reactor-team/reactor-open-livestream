export const ACTIVE_PROMPT_STATUSES = ["pending", "queued", "playing"] as const;
export const PROMPT_LIMIT_REASON = "You already have a prompt in the broadcast. Wait until it finishes before submitting another.";

export function activeViewerPrompt<T extends { identity: string; status: string }>(prompts: T[] | undefined, identity: string): T | undefined {
  if (!identity) return undefined;
  return prompts?.find(prompt => prompt.identity === identity && ACTIVE_PROMPT_STATUSES.some(status => status === prompt.status));
}

export function promptQueueLabel(position: number): string {
  return "#" + position + " in queue";
}
