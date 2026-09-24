"use client";

import {
  RiAddLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiDownloadLine,
  RiEyeLine,
  RiEyeOffLine,
  RiImageAddLine,
  RiKey2Line,
  RiLoader4Line,
  RiPlayLine,
  RiPlayListAddLine,
  RiRefreshLine,
  RiSaveLine,
  RiSparkling2Line,
} from "@remixicon/react";
import { type ChangeEvent, type DragEvent, useEffect, useMemo, useRef, useState } from "react";

import { programmingRequest, saveSegmentDraft, hydrateSegment, type OpeningFrame, type SegmentDraft } from "@/lib/segment-library";

const STORAGE_KEY = "reactor-tv:segment-drafts";
const OPENAI_KEY = "reactor-tv:openai-key";
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600;


type GeneratedSegment = {
  continuityNotes?: unknown;
  error?: unknown;
  imageAnalysis?: unknown;
  imageModel?: unknown;
  model?: unknown;
  openingFrameDataUrl?: unknown;
  startingPrompt?: unknown;
  title?: unknown;
  voicePrompt?: unknown;
};

type SegmentField = "title" | "imageAnalysis" | "startingPrompt" | "continuityNotes" | "voicePrompt";

type RegeneratedSegmentField = {
  error?: unknown;
  model?: unknown;
  value?: unknown;
};

const SEGMENT_FIELD_LABELS: Record<SegmentField, string> = {
  title: "Segment name",
  imageAnalysis: "Image understanding",
  startingPrompt: "Starting prompt",
  continuityNotes: "Continuity notes",
  voicePrompt: "Character voice casting",
};

export type SegmentQueueInput = {
  chunkSeconds?: number;
  action: "play" | "queue";
  continuityNotes?: string;
  voicePrompt?: string;
  openingFrameDataUrl?: string;
  text: string;
};

type SegmentWorkshopProps = {
  chunkSeconds: number;
  onClose: () => void;
  onGeneratingChange: (generating: boolean) => void;
  onQueue: (input: SegmentQueueInput) => Promise<void>;
  open: boolean;
};

function createDraft(id = "new-segment"): SegmentDraft {
  return {
    id,
    title: "Untitled segment",
    direction: "",
    continuity: "",
    experience: "",
    imageAnalysis: "",
    generationModel: "",
    voicePrompt: "",
  };
}

function normalizeDraft(value: unknown): SegmentDraft | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Partial<SegmentDraft>;
  if (
    typeof item.id !== "string" ||
    typeof item.title !== "string" ||
    typeof item.direction !== "string" ||
    typeof item.continuity !== "string"
  ) return null;
  return {
    id: item.id,
    title: item.title,
    direction: item.direction,
    continuity: item.continuity,
    voicePrompt: typeof item.voicePrompt === "string" ? item.voicePrompt : "",
    experience: typeof item.experience === "string" ? item.experience : "",
    imageAnalysis: typeof item.imageAnalysis === "string" ? item.imageAnalysis : "",
    generationModel: typeof item.generationModel === "string" ? item.generationModel : "",
    openingFrame: item.openingFrame,
    savedAt: typeof item.savedAt === "number" ? item.savedAt : undefined,
  };
}

function loadDrafts(): SegmentDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]") as unknown;
    return Array.isArray(value) ? value.map(normalizeDraft).filter((item): item is SegmentDraft => item !== null) : [];
  } catch {
    return [];
  }
}

function loadOpenAIKey(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(OPENAI_KEY) || "";
}

function safeFileName(value: string): string {
  const name = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return name || "segment";
}

function savedTime(value?: number): string {
  if (!value) return "Unsaved";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(value);
}

function dataUrlFromBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this image"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not prepare this image"));
    }, "image/webp", quality);
  });
}

async function prepareOpeningFrame(file: File): Promise<OpeningFrame> {
  if (!file.type.startsWith("image/")) throw new Error("Drop a JPEG, PNG, or WebP image");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Opening frames must be smaller than 12 MB");

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Could not prepare this image");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let blob = await canvasBlob(canvas, 0.86);
  if (blob.size > 2.5 * 1024 * 1024) blob = await canvasBlob(canvas, 0.7);
  return {
    bytes: blob.size,
    dataUrl: await dataUrlFromBlob(blob),
    height,
    name: file.name,
    width,
  };
}

async function openingFrameFromDataUrl(dataUrl: string): Promise<OpeningFrame> {
  const blob = await fetch(dataUrl).then((response) => response.blob());
  const bitmap = await createImageBitmap(blob);
  const frame = {
    bytes: blob.size,
    dataUrl,
    height: bitmap.height,
    name: "GPT Image 2 opening frame",
    width: bitmap.width,
  };
  bitmap.close();
  return frame;
}

export default function SegmentWorkshop({
  chunkSeconds,
  onClose,
  onGeneratingChange,
  onQueue,
  open,
}: SegmentWorkshopProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<SegmentDraft[]>([]);
  const [draft, setDraft] = useState<SegmentDraft>(() => createDraft());
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [legacyDrafts, setLegacyDrafts] = useState<SegmentDraft[]>([]);
  const [openAIKey, setOpenAIKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [keyStored, setKeyStored] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [pendingOpeningFrame, setPendingOpeningFrame] = useState<OpeningFrame | null>(null);
  const [openingFrameContext, setOpeningFrameContext] = useState("");
  const [generating, setGenerating] = useState(false);
  const [regenerateField, setRegenerateField] = useState<SegmentField | null>(null);
  const [regenerateDirection, setRegenerateDirection] = useState("");
  const [regeneratingField, setRegeneratingField] = useState<SegmentField | null>(null);
  const [queueing, setQueueing] = useState<"play" | "queue" | null>(null);
  const jobRunning = generating || regeneratingField !== null;
  const hasGeneratedSegment = Boolean(draft.generationModel || draft.direction.trim());

  useEffect(() => {
    let cancelled = false;
    const storedDrafts = loadDrafts();
    const storedKey = loadOpenAIKey();
    queueMicrotask(() => {
      if (cancelled) return;
      setLegacyDrafts(storedDrafts);
      setDraft(createDraft(crypto.randomUUID()));
      setOpenAIKey(storedKey);
      setKeyStored(Boolean(storedKey));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    programmingRequest().then(data => { if (!cancelled) setDrafts(data.segments); })
      .catch(error => { if (!cancelled) setNotice(error.message); });
    return () => { cancelled = true; };
  }, [open]);
  const exportValue = useMemo(() => ({
    format: "reactor-tv-segment",
    version: 3,
    title: draft.title.trim() || "Untitled segment",
    experience: draft.experience.trim(),
    openingFrame: draft.openingFrame || null,
    imageAnalysis: draft.imageAnalysis.trim(),
    startingPrompt: draft.direction.trim(),
    continuityNotes: draft.continuity.trim(),
    voicePrompt: draft.voicePrompt.trim(),
    generationModel: draft.generationModel || null,
    chunkSeconds: draft.chunkSeconds ?? null,
    durationSeconds: chunkSeconds,
    savedAt: draft.savedAt ? new Date(draft.savedAt).toISOString() : null,
  }), [chunkSeconds, draft]);

  function updateDraft(patch: Partial<SegmentDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setNotice("");
  }

  function updateSource(patch: Pick<Partial<SegmentDraft>, "experience" | "openingFrame">) {
    updateDraft({
      ...patch,
      continuity: "",
      direction: "",
      generationModel: "",
      imageAnalysis: "",
      voicePrompt: "",
    });
  }

  function saveKey() {
    const value = openAIKey.trim();
    if (!value) {
      window.sessionStorage.removeItem(OPENAI_KEY);
      setKeyStored(false);
      setNotice("OpenAI key cleared");
      return;
    }
    window.sessionStorage.setItem(OPENAI_KEY, value);
    setOpenAIKey(value);
    setKeyStored(true);
    setNotice("OpenAI key available for this tab");
  }

  function clearKey() {
    window.sessionStorage.removeItem(OPENAI_KEY);
    setOpenAIKey("");
    setKeyStored(false);
    setNotice("OpenAI key cleared");
  }

  async function saveDraft() {
    setSaving(true);
    try {
      const result = await saveSegmentDraft(draft);
      const saved = result.segments.find(item => item.id === result.savedId);
      if (saved) setDraft({ ...saved, openingFrame: draft.openingFrame ? { ...draft.openingFrame, storageId: saved.openingFrame?.storageId } : undefined });
      setDrafts(result.segments);
      setNotice("Saved to Convex. Schedule this segment in Admin.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save segment"); }
    finally { setSaving(false); }
  }

  async function selectDraft(item: SegmentDraft) {
    setSaving(true);
    try { setDraft(await hydrateSegment(item)); setNotice(""); }
    catch { setNotice("Could not load this segment's opening frame"); }
    finally { setSaving(false); }
  }

  async function importBrowserDrafts() {
    setSaving(true);
    try {
      for (const item of legacyDrafts) {
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(item)));
        const key = "legacy:" + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
        await saveSegmentDraft({ ...item, id: key, persisted: false });
      }
      setDrafts((await programmingRequest()).segments);
      setLegacyDrafts([]);
      setNotice("Browser drafts imported into Convex. The original browser backup is untouched.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not import browser drafts"); }
    finally { setSaving(false); }
  }

  function newDraft() {
    if (jobRunning || saving) return;
    setPendingOpeningFrame(null);
    setOpeningFrameContext("");
    setDraft(createDraft(crypto.randomUUID()));
    setNotice("");
  }

  function closeOpeningFrameContext() {
    setPendingOpeningFrame(null);
    setOpeningFrameContext("");
    setNotice("");
  }

  function confirmOpeningFrame() {
    if (!pendingOpeningFrame) return;
    updateSource({
      experience: openingFrameContext.trim(),
      openingFrame: pendingOpeningFrame,
    });
    setPendingOpeningFrame(null);
    setOpeningFrameContext("");
    setNotice("Opening frame ready for analysis");
  }

  function openRegenerateModal(field: SegmentField) {
    if (jobRunning) return;
    setRegenerateField(field);
    setRegenerateDirection("");
    setNotice("");
  }

  function closeRegenerateModal() {
    if (regeneratingField) return;
    setRegenerateField(null);
    setRegenerateDirection("");
  }

  function exportDraft() {
    const blob = new Blob([`${JSON.stringify(exportValue, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFileName(exportValue.title)}.segment.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Segment exported");
  }

  async function acceptOpeningFrame(file?: File) {
    if (!file) return;
    setNotice("Preparing opening frame");
    try {
      const openingFrame = await prepareOpeningFrame(file);
      setPendingOpeningFrame(openingFrame);
      setOpeningFrameContext(draft.experience);
      setNotice("");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Could not prepare this image");
    }
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    void acceptOpeningFrame(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    void acceptOpeningFrame(event.dataTransfer.files?.[0]);
  }

  async function generateDraft() {
    if (!draft.openingFrame && !draft.experience.trim()) {
      setNotice("Describe the experience or attach a reference frame");
      return;
    }
    if (!openAIKey.trim()) {
      setNotice("Enter your OpenAI key in the top-left panel");
      return;
    }
    setGenerating(true);
    onGeneratingChange(true);
    setNotice("");
    try {
      const response = await fetch("/api/dev/segment", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openai-api-key": openAIKey.trim(),
        },
        body: JSON.stringify({
          experience: draft.experience.trim(),
          imageDataUrl: draft.openingFrame?.dataUrl,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as GeneratedSegment;
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Could not generate segment");
      if (
        typeof result.title !== "string" ||
        typeof result.imageAnalysis !== "string" ||
        typeof result.startingPrompt !== "string" ||
        typeof result.continuityNotes !== "string" ||
        typeof result.voicePrompt !== "string"
      ) throw new Error("OpenAI returned an incomplete segment plan");
      const openingFrame = typeof result.openingFrameDataUrl === "string"
        ? await openingFrameFromDataUrl(result.openingFrameDataUrl)
        : draft.openingFrame;
      updateDraft({
        title: result.title,
        imageAnalysis: result.imageAnalysis,
        direction: result.startingPrompt,
        continuity: result.continuityNotes,
        voicePrompt: result.voicePrompt,
        generationModel: typeof result.model === "string" ? result.model : "OpenAI",
        openingFrame,
      });
      const imageDetail = typeof result.imageModel === "string" ? ` and ${result.imageModel}` : "";
      setNotice(`Generated with ${typeof result.model === "string" ? result.model : "OpenAI"}${imageDetail}`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Could not generate segment");
    } finally {
      setGenerating(false);
      onGeneratingChange(false);
    }
  }

  async function regenerateDraftField() {
    if (!regenerateField || regeneratingField) return;
    if (!openAIKey.trim()) {
      setNotice("Enter your OpenAI key in the top-left panel");
      return;
    }

    const field = regenerateField;
    setRegeneratingField(field);
    onGeneratingChange(true);
    setNotice("");
    try {
      const response = await fetch("/api/dev/segment/regenerate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openai-api-key": openAIKey.trim(),
        },
        body: JSON.stringify({
          field,
          changeRequest: regenerateDirection.trim(),
          title: draft.title.trim(),
          imageAnalysis: draft.imageAnalysis.trim(),
          startingPrompt: draft.direction.trim(),
          continuityNotes: draft.continuity.trim(),
          voicePrompt: draft.voicePrompt.trim(),
          experience: draft.experience.trim(),
          imageDataUrl: draft.openingFrame?.dataUrl,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as RegeneratedSegmentField;
      if (!response.ok) {
        throw new Error(typeof result.error === "string" ? result.error : `Could not regenerate ${SEGMENT_FIELD_LABELS[field].toLowerCase()}`);
      }
      if (typeof result.value !== "string") throw new Error("OpenAI returned an incomplete revision");

      const patch: Partial<SegmentDraft> = {
        generationModel: typeof result.model === "string" ? result.model : draft.generationModel,
      };
      if (field === "title") patch.title = result.value;
      if (field === "imageAnalysis") patch.imageAnalysis = result.value;
      if (field === "startingPrompt") patch.direction = result.value;
      if (field === "continuityNotes") patch.continuity = result.value;
      if (field === "voicePrompt") patch.voicePrompt = result.value;
      updateDraft(patch);
      setNotice(`Regenerated ${SEGMENT_FIELD_LABELS[field].toLowerCase()} with ${typeof result.model === "string" ? result.model : "OpenAI"}`);
      setRegenerateField(null);
      setRegenerateDirection("");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Could not regenerate this field");
    } finally {
      setRegeneratingField(null);
      onGeneratingChange(false);
    }
  }

  async function queueDraft(action: "play" | "queue") {
    if (!draft.direction.trim()) {
      setNotice("Generate or write a starting prompt first");
      return;
    }
    setQueueing(action);
    try {
      await onQueue({
        action,
        chunkSeconds: draft.chunkSeconds,
        text: draft.direction.trim(),
        continuityNotes: draft.continuity.trim() || undefined,
        voicePrompt: draft.voicePrompt.trim() || undefined,
        openingFrameDataUrl: draft.openingFrame?.dataUrl,
      });
      setNotice(action === "play"
        ? "Segment will take over as soon as its opening chunk is ready"
        : "Segment added to the development queue");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message.replace(/^.*Uncaught Error: /, "") : "Could not queue segment");
    } finally {
      setQueueing(null);
    }
  }


  return (
    <section aria-busy={jobRunning || saving} inert={saving} aria-label="Segment workshop" className="segment-workshop" hidden={!open}>
      <header className="segment-workshop-header">
        <div>
          <span className="system-label">Development workspace</span>
          <strong>Segment workshop</strong>
        </div>
        <div className="segment-workshop-actions">
          {hasGeneratedSegment ? (
            <>
              <button
                className="segment-play-button"
                disabled={jobRunning || Boolean(queueing)}
                onClick={() => void queueDraft("play")}
                type="button"
              ><RiPlayLine aria-hidden="true" /> {queueing === "play" ? "Preparing" : "Play from start"}</button>
              <button
                disabled={jobRunning || Boolean(queueing)}
                onClick={() => void queueDraft("queue")}
                type="button"
              ><RiPlayListAddLine aria-hidden="true" /> {queueing === "queue" ? "Queueing" : "Queue segment"}</button>
            </>
          ) : null}
          <button disabled={jobRunning} onClick={newDraft} type="button"><RiAddLine aria-hidden="true" /> New</button>
          <button aria-label="Close segment workshop" className="icon-button" onClick={onClose} type="button">
            <RiCloseLine aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="segment-workshop-grid">
        <nav aria-label="Segment tools and saved drafts" className="segment-library">
          <section className="segment-key-panel">
            <div className="segment-key-heading">
              <RiKey2Line aria-hidden="true" />
              <span className="segment-column-label">OpenAI key</span>
              <i data-ready={keyStored}>{keyStored ? "Ready" : "Required"}</i>
            </div>
            <p>Used only for image understanding and segment completion. Kept in this browser tab, never saved with a draft.</p>
            <div className="segment-key-input">
              <input
                aria-label="OpenAI API key"
                autoComplete="off"
                onChange={(event) => { setOpenAIKey(event.target.value); setKeyStored(false); }}
                placeholder="sk-..."
                spellCheck={false}
                type={keyVisible ? "text" : "password"}
                value={openAIKey}
              />
              <button aria-label={keyVisible ? "Hide OpenAI key" : "Show OpenAI key"} onClick={() => setKeyVisible((value) => !value)} type="button">
                {keyVisible ? <RiEyeOffLine aria-hidden="true" /> : <RiEyeLine aria-hidden="true" />}
              </button>
            </div>
            <div className="segment-key-actions">
              <button onClick={saveKey} type="button">Use key</button>
              {openAIKey ? <button onClick={clearKey} type="button">Clear</button> : null}
            </div>
          </section>

          <div className="segment-library-heading">
            <span className="segment-column-label">Segment library</span>
            <span>{drafts.length}</span>
          </div>
          <div className="segment-library-list">
            {legacyDrafts.length > 0 && <button type="button" disabled={saving || jobRunning} onClick={() => void importBrowserDrafts()}>Import {legacyDrafts.length} browser drafts</button>}
            <a href="/admin">Manage schedule in Admin</a>
            {drafts.length ? drafts.map((item) => (
              <button
                className={item.id === draft.id ? "is-active" : undefined}
                disabled={jobRunning || saving}
                key={item.id}
                onClick={() => void selectDraft(item)}
                type="button"
              >
                <strong>{item.title}</strong>
                <span>{savedTime(item.savedAt)}</span>
              </button>
            )) : (
              <p>No saved segments yet. Saved segments live in Convex.</p>
            )}
          </div>
        </nav>

        <div className="segment-editor">
          <div className="segment-creation-intro">
            <span className="segment-step">01</span>
            <div><strong>Start with an idea</strong><p>Describe the experience, attach a reference frame, or use both. If no image is supplied, GPT Image will create the opening frame.</p></div>
          </div>

          <label className="segment-experience-field">
            <span>Experience direction</span>
            <small>Describe what this should become. You can leave this blank when a reference frame supplies the idea.</small>
            <textarea
              aria-label="Experience direction"
              maxLength={1200}
              onChange={(event) => updateSource({ experience: event.target.value })}
              placeholder="A tense, absurd cold open that slowly reveals the room is inside a pressure cooker..."
              value={draft.experience}
            />
          </label>

          <div className="opening-frame-shell">
            <div
              aria-label={draft.openingFrame ? "Replace opening frame" : "Attach opening frame"}
              className={`opening-frame-drop${dragActive ? " is-dragging" : ""}${draft.openingFrame ? " has-image" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragLeave={(event) => { event.preventDefault(); setDragActive(false); }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
              }}
              role="button"
              tabIndex={0}
            >
              {draft.openingFrame ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="Attached opening frame" src={draft.openingFrame.dataUrl} />
                  <div className="opening-frame-caption">
                    <strong>{draft.openingFrame.name}</strong>
                    <span>{draft.openingFrame.width} x {draft.openingFrame.height}, {Math.ceil(draft.openingFrame.bytes / 1024)} KB</span>
                  </div>
                </>
              ) : (
                <div className="opening-frame-empty">
                  <RiImageAddLine aria-hidden="true" />
                  <strong>Optional reference frame</strong>
                  <span>Drag in a JPEG, PNG, or WebP, or skip this and GPT Image will create one</span>
                </div>
              )}
            </div>
            {draft.openingFrame ? (
              <button
                aria-label="Remove opening frame"
                className="opening-frame-remove"
                onClick={() => updateSource({ openingFrame: undefined })}
                type="button"
              ><RiDeleteBinLine aria-hidden="true" /></button>
            ) : null}
            <input
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={handleFileInput}
              ref={fileInputRef}
              type="file"
            />
          </div>

          <button className="segment-generate-button" disabled={jobRunning} onClick={() => void generateDraft()} type="button">
            {generating ? <RiLoader4Line aria-hidden="true" className="is-spinning" /> : <RiSparkling2Line aria-hidden="true" />}
            {generating
              ? "Building segment"
              : (draft.openingFrame ? "Understand frame and create segment" : "Generate frame and create segment")}
          </button>

          {generating ? (
            <div aria-live="polite" className="segment-generation-status" role="status">
              <RiLoader4Line aria-hidden="true" className="is-spinning" />
              <div>
                <strong>{draft.openingFrame ? "Understanding the frame" : "Generating the opening frame"}</strong>
                <span>OpenAI is preparing the image, first prompt, and continuity notes. You can close this panel while it runs.</span>
              </div>
            </div>
          ) : notice && !hasGeneratedSegment ? (
            <p aria-live="polite" className="segment-creation-notice">{notice}</p>
          ) : null}

          {hasGeneratedSegment ? (
            <>
              <div className="segment-generated-divider">
                <span className="segment-step">02</span>
                <strong>Generated segment</strong>
                {draft.generationModel ? <i>{draft.generationModel}</i> : null}
              </div>

              <div className="segment-field">
                <div className="segment-field-heading">
                  <label htmlFor="segment-title">Segment name</label>
                  <button disabled={jobRunning} onClick={() => openRegenerateModal("title")} type="button"><RiRefreshLine aria-hidden="true" /> Regenerate</button>
                </div>
                <input
                  aria-label="Segment name"
                  id="segment-title"
                  maxLength={80}
                  onChange={(event) => updateDraft({ title: event.target.value })}
                  value={draft.title}
                />
              </div>
              <div className="segment-analysis-field segment-field">
                <div className="segment-field-heading">
                  <label htmlFor="segment-image-analysis">Image understanding</label>
                  <button disabled={jobRunning} onClick={() => openRegenerateModal("imageAnalysis")} type="button"><RiRefreshLine aria-hidden="true" /> Regenerate</button>
                </div>
                <small>The grounded visual reading used to create the prompt and continuity plan.</small>
                <textarea
                  aria-label="Image understanding"
                  id="segment-image-analysis"
                  maxLength={1800}
                  onChange={(event) => updateDraft({ imageAnalysis: event.target.value })}
                  value={draft.imageAnalysis}
                />
              </div>
              <div className="segment-direction-field segment-field">
                <div className="segment-field-heading">
                  <label htmlFor="segment-starting-prompt">Starting prompt</label>
                  <button disabled={jobRunning} onClick={() => openRegenerateModal("startingPrompt")} type="button"><RiRefreshLine aria-hidden="true" /> Regenerate</button>
                </div>
                <small>The first chunk begins from this frame. This is the prompt sent to the live generation queue.</small>
                <textarea
                  aria-label="Starting prompt"
                  id="segment-starting-prompt"
                  maxLength={800}
                  onChange={(event) => updateDraft({ direction: event.target.value })}
                  value={draft.direction}
                />
                <b>{draft.direction.length} / 800</b>
              </div>
              <div className="segment-continuity-field segment-field">
                <div className="segment-field-heading">
                  <label htmlFor="segment-continuity-notes">Continuity notes</label>
                  <button disabled={jobRunning} onClick={() => openRegenerateModal("continuityNotes")} type="button"><RiRefreshLine aria-hidden="true" /> Regenerate</button>
                </div>
                <small>The segment-wide premise, vibe, format, world rules, and facts that must remain true in every generated chunk.</small>
                <textarea
                  aria-label="Continuity notes"
                  id="segment-continuity-notes"
                  maxLength={1600}
                  onChange={(event) => updateDraft({ continuity: event.target.value })}
                  value={draft.continuity}
                />
              </div>
              <div className="segment-voice-field segment-field">
                <div className="segment-field-heading">
                  <label htmlFor="segment-voice-prompt">Character voice casting</label>
                  <button disabled={jobRunning} onClick={() => openRegenerateModal("voicePrompt")} type="button"><RiRefreshLine aria-hidden="true" /> Regenerate</button>
                </div>
                <small>Describe how each recurring speaker sounds. These are silent production notes, never words for the character to say.</small>
                <textarea
                  aria-label="Character voice casting"
                  id="segment-voice-prompt"
                  maxLength={360}
                  onChange={(event) => updateDraft({ voicePrompt: event.target.value })}
                  placeholder="Host voice: a bright youthful American tenor with quick, emphatic cadence, crisp diction, and energetic upward inflection."
                  value={draft.voicePrompt}
                />
              </div>
              <footer className="segment-editor-footer">
                <span aria-live="polite">{notice}</span>
                <div>
                  <button disabled={saving || jobRunning} onClick={() => void saveDraft()} type="button"><RiSaveLine aria-hidden="true" /> Save draft</button>
                  <button onClick={exportDraft} type="button"><RiDownloadLine aria-hidden="true" /> Export JSON</button>
                </div>
              </footer>
            </>
          ) : null}
        </div>
      </div>

      {regenerateField ? (
        <div
          className="segment-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeRegenerateModal();
          }}
        >
          <section aria-labelledby="segment-regenerate-title" aria-modal="true" className="segment-regenerate-modal" role="dialog">
            <header>
              <div>
                <span className="system-label">Revise generated field</span>
                <strong id="segment-regenerate-title">Regenerate {SEGMENT_FIELD_LABELS[regenerateField]}</strong>
              </div>
              <button aria-label="Close regenerate dialogue" className="icon-button" disabled={Boolean(regeneratingField)} onClick={closeRegenerateModal} type="button">
                <RiCloseLine aria-hidden="true" />
              </button>
            </header>
            <label>
              <span>Change it how? <em>Optional</em></span>
              <small>Describe a specific change or new direction. Leave this blank for a fresh variation that still fits the rest of the segment.</small>
              <textarea
                autoFocus
                maxLength={800}
                onChange={(event) => setRegenerateDirection(event.target.value)}
                placeholder="Make it stranger, quieter, and less literal..."
                value={regenerateDirection}
              />
            </label>
            <footer>
              <span aria-live="polite">{regeneratingField ? `Regenerating ${SEGMENT_FIELD_LABELS[regeneratingField].toLowerCase()}` : notice}</span>
              <div>
                <button disabled={Boolean(regeneratingField)} onClick={closeRegenerateModal} type="button">Cancel</button>
                <button className="segment-regenerate-submit" disabled={Boolean(regeneratingField)} onClick={() => void regenerateDraftField()} type="button">
                  {regeneratingField ? <RiLoader4Line aria-hidden="true" className="is-spinning" /> : <RiRefreshLine aria-hidden="true" />}
                  {regeneratingField ? "Regenerating" : "Regenerate"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      {pendingOpeningFrame ? (
        <div
          className="segment-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeOpeningFrameContext();
          }}
        >
          <section aria-labelledby="segment-frame-context-title" aria-modal="true" className="segment-regenerate-modal" role="dialog">
            <header>
              <div>
                <span className="system-label">Context for opening frame</span>
                <strong id="segment-frame-context-title">Anything else should we know before generating?</strong>
              </div>
              <button aria-label="Close opening frame context" className="icon-button" onClick={closeOpeningFrameContext} type="button">
                <RiCloseLine aria-hidden="true" />
              </button>
            </header>
            <label>
              <span>Additional context <em>Optional</em></span>
              <small>Clarify who or what is pictured, the intended premise, relationships, tone, or anything the image alone might not explain.</small>
              <textarea
                autoFocus
                maxLength={1200}
                onChange={(event) => setOpeningFrameContext(event.target.value)}
                placeholder="The person on the left is the host. This should feel like a tense late-night call-in show..."
                value={openingFrameContext}
              />
            </label>
            <footer>
              <span>{pendingOpeningFrame.name}</span>
              <div>
                <button onClick={closeOpeningFrameContext} type="button">Cancel</button>
                <button className="segment-regenerate-submit" onClick={confirmOpeningFrame} type="button">Use this frame</button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
