export type PrivatePromptEntry = {
  _id: string;
  kind: "private-prompt";
  createdAt: number;
  body: string;
  author: string;
  status: "checking" | "rejected" | "failed" | "uncertain";
  reason?: string;
};

export function mergePrivatePrompts<T extends { _id: string; createdAt: number }>(
  messages: readonly T[], privateEntries: readonly PrivatePromptEntry[],
): Array<T | PrivatePromptEntry> {
  return [...messages, ...privateEntries].sort((a, b) => a.createdAt - b.createdAt);
}
