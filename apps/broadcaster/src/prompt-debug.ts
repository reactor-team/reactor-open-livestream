export type PromptTrace = {
  id: string; clipId: string | null; prompt: string; seconds: number;
  phase: "opening" | "continuation"; state: string; at: number;
  startingFrame: boolean; endingFrame: boolean; sameEndpoints: boolean;
  continueFrom: string | null;
};

/** Bounded, process-local and deliberately excludes metadata, files, tokens and URLs. */
export class PromptDebugLog {
  #entries: PromptTrace[] = [];
  sent(id: string, payload: Record<string, unknown>): void {
    this.#entries = [{
      id, clipId: null, prompt: String(payload.prompt ?? "").slice(0, 800),
      seconds: Number(payload.seconds) || 0,
      phase: payload.continue_from_clip_id ? "continuation" as const : "opening" as const,
      state: "sending", at: Date.now(),
      startingFrame: Boolean(payload.starting_frame), endingFrame: Boolean(payload.ending_frame),
      sameEndpoints: Boolean(payload.starting_frame && payload.ending_frame &&
        JSON.stringify(payload.starting_frame) === JSON.stringify(payload.ending_frame)),
      continueFrom: typeof payload.continue_from_clip_id === "string" ? payload.continue_from_clip_id : null,
    }, ...this.#entries].slice(0, 12);
  }
  accepted(id: string, clipId: string | null): void {
    const entry = this.#entries.find(item => item.id === id);
    if (entry) { entry.clipId = clipId; entry.state = clipId ? "queued" : "rejected"; }
  }
  event(clipId: string, state: string): void {
    const entry = this.#entries.find(item => item.clipId === clipId);
    if (entry) entry.state = state;
  }
  snapshot(): PromptTrace[] { return this.#entries.map(item => ({ ...item })); }
  clear(): void { this.#entries = []; }
}
