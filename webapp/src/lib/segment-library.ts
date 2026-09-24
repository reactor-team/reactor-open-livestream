import { backendFetch } from "./backend-fetch";
export type OpeningFrame = {
  bytes: number; dataUrl: string; height: number; name: string; width: number; storageId?: string;
};
export type SegmentDraft = {
  id: string; persisted?: boolean; chunkSeconds?: number; title: string; direction: string; continuity: string;
  voicePrompt: string; experience: string; imageAnalysis: string; generationModel: string;
  openingFrame?: OpeningFrame; savedAt?: number;
};
export type ScheduleEntry = {
  _id: string; segmentId: string; title: string; durationSeconds: number; position: number; enabled: boolean;
};
export type Library = { segments: SegmentDraft[]; schedule: ScheduleEntry[] };
const endpoint = "/admin/api/programming";

export async function programmingRequest(body?: unknown): Promise<Library & { savedId?: string }> {
  const response = await backendFetch(endpoint, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load programming");
  return result;
}
export async function saveSegmentDraft(draft: SegmentDraft) {
  return programmingRequest({ operation: "save", draft });
}
export async function hydrateSegment(draft: SegmentDraft): Promise<SegmentDraft> {
  const frame = draft.openingFrame;
  if (!frame || frame.dataUrl.startsWith("data:")) return draft;
  const response = await fetch(frame.dataUrl);
  if (!response.ok) throw new Error("Could not load the opening frame");
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return { ...draft, openingFrame: { ...frame, dataUrl } };
}
