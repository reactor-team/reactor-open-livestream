export type OnAirPrompt = { _id: string; text: string; author: string };

/** Match the playback heartbeat, not the next prepared or queued direction. */
export function onAirViewerPrompt({ ready, prompts, currentPrompt, currentAuthor }: {
  ready: boolean;
  prompts?: readonly (OnAirPrompt & { status: string })[];
  currentPrompt?: string;
  currentAuthor?: string;
}): OnAirPrompt | null {
  if (!ready || !currentPrompt?.trim()) return null;
  return prompts?.find(prompt => prompt.status === "playing"
    && prompt.text === currentPrompt && prompt.author === currentAuthor) ?? null;
}

export function promptPreview(text: string): string {
  const compact = text.trim().replace(/\s+/g, " ");
  const words = compact.split(" ").slice(0, 8).join(" ");
  const preview = Array.from(words).slice(0, 96).join("").trimEnd();
  return preview + (preview.length < compact.length ? "…" : "");
}
