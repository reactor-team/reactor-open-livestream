"use client";
import { backendFetch } from "@/lib/backend-fetch";

import { useEffect, useRef, useState } from "react";
import { RiLoader4Line, RiSparkling2Line } from "@remixicon/react";
import { hydrateSegment, type SegmentDraft } from "@/lib/segment-library";

export type EnrichField = "title" | "direction" | "continuity" | "voicePrompt" | "experience" | "imageAnalysis";
export const FIELD_LABELS: Record<EnrichField, string> = {
  title: "Segment name", direction: "Starting prompt", continuity: "Continuity notes",
  voicePrompt: "Character voices", experience: "Experience direction", imageAnalysis: "Image understanding",
};
const apiFields = { title: "title", direction: "startingPrompt", continuity: "continuityNotes", voicePrompt: "voicePrompt", experience: "experience", imageAnalysis: "imageAnalysis" };

export default function EnrichDialog({ field, draft, defaultChunkSeconds, onClose, onApply }: {
  field: EnrichField; draft: SegmentDraft; defaultChunkSeconds: number;
  onClose: () => void; onApply: (field: EnrichField, value: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [change, setChange] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function enrich() {
    setPending(true); setError("");
    try {
      const hydrated = await hydrateSegment(draft);
      const response = await backendFetch("/admin/api/enrich", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ field: apiFields[field], title: draft.title, startingPrompt: draft.direction,
          continuityNotes: draft.continuity, voicePrompt: draft.voicePrompt, experience: draft.experience,
          imageAnalysis: draft.imageAnalysis, imageDataUrl: hydrated.openingFrame?.dataUrl,
          chunkSeconds: draft.chunkSeconds ?? defaultChunkSeconds, changeRequest: change }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.value !== "string") throw new Error(result.error || "Could not enrich this field");
      onApply(field, result.value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enrichment failed"); }
    finally { setPending(false); }
  }
  return <dialog ref={dialog} className="programming-enrich-dialog" aria-labelledby="enrich-heading" onCancel={event => { if (pending) event.preventDefault(); else onClose(); }} onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); void enrich(); }}>
      <header><h3 id="enrich-heading">Enrich {FIELD_LABELS[field].toLowerCase()}</h3><button type="button" aria-label="Close enrichment" disabled={pending} onClick={onClose}>×</button></header>
      <p>Only this field changes. Review the result before saving the segment.</p>
      <label>Change it how? <small>Optional</small><textarea autoFocus rows={4} maxLength={800} placeholder="Make it more understated, add context, or take it in a new direction..." value={change} disabled={pending} onChange={event => setChange(event.target.value)} /></label>
      <small>Generated securely through the Reactor backend. No personal API key needed.</small>
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={pending} onClick={onClose}>Cancel</button><button type="submit" className="programming-primary" disabled={pending}>
        {pending ? <RiLoader4Line className="programming-spinner" aria-hidden="true" /> : <RiSparkling2Line aria-hidden="true" />}{pending ? "Enriching..." : "Enrich field"}
      </button></footer>
    </form>
  </dialog>;
}
