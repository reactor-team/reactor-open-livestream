"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RiSparkling2Line } from "@remixicon/react";
import EnrichDialog, { FIELD_LABELS, type EnrichField } from "./enrich-dialog";
import { programmingRequest, saveSegmentDraft, type Library, type SegmentDraft } from "@/lib/segment-library";

const blank = (): SegmentDraft => ({ id: crypto.randomUUID(), title: "Untitled segment", direction: "", continuity: "", voicePrompt: "", experience: "", imageAnalysis: "", generationModel: "" });

export default function ProgrammingPanel({ defaultChunkSeconds }: { defaultChunkSeconds: number }) {
  const [library, setLibrary] = useState<Library>({ segments: [], schedule: [] });
  const [draft, setDraft] = useState<SegmentDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [enrichField, setEnrichField] = useState<EnrichField | null>(null);

  useEffect(() => {
    let cancelled = false;
    programmingRequest().then(data => {
      if (cancelled) return;
      setLibrary(data); setDraft(data.segments[0] ?? blank());
    }).catch(error => { if (!cancelled) setNotice(error.message); });
    return () => { cancelled = true; };
  }, []);

  function patch(value: Partial<SegmentDraft>) {
    setDraft(current => current ? { ...current, ...value } : current);
    setDirty(true); setNotice("");
  }
  function select(next: SegmentDraft) {
    if (dirty && !window.confirm("Discard unsaved changes to this segment?")) return;
    setDraft(next); setDirty(false); setNotice("");
  }
  async function save() {
    if (!draft) return;
    setBusy(true); setNotice("");
    try {
      const result = await saveSegmentDraft(draft);
      setLibrary(result); setDraft(result.segments.find(row => row.id === result.savedId) ?? draft);
      setDirty(false); setNotice("Segment saved to Convex");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save"); }
    finally { setBusy(false); }
  }
  async function editSchedule(edit: Record<string, unknown>) {
    setBusy(true); setNotice("");
    try { setLibrary(await programmingRequest({ operation: "schedule", edit })); setNotice("Schedule saved to Convex"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not update schedule"); }
    finally { setBusy(false); }
  }
  async function attach(file?: File) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) {
      setNotice("Choose a JPEG, PNG, or WebP under 5 MB"); return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
      });
      patch({ openingFrame: { name: file.name, bytes: file.size, width: bitmap.width, height: bitmap.height, dataUrl } });
      bitmap.close();
    } catch { setNotice("Could not read this image"); }
  }
  function field(name: EnrichField, limit: number, rows: number, hint?: string, optional = false) {
    if (!draft) return null;
    const id = "segment-" + name;
    return <div className="programming-text-field">
      <div className="programming-field-heading">
        <label htmlFor={id}>{FIELD_LABELS[name]}{optional && <small>Optional</small>}</label>
        <button type="button" className="programming-enrich-button" aria-label={"Enrich " + FIELD_LABELS[name].toLowerCase()}
          disabled={busy || (name === "imageAnalysis" && !draft.openingFrame)} title={name === "imageAnalysis" && !draft.openingFrame ? "Attach an opening frame to analyze it" : undefined}
          onClick={() => setEnrichField(name)}><RiSparkling2Line aria-hidden="true" /> Enrich</button>
      </div>
      {hint && <small id={id + "-hint"}>{hint}</small>}
      {name === "title" ? <input id={id} value={draft[name]} maxLength={limit} onChange={event => patch({ [name]: event.target.value })} />
        : <textarea id={id} aria-describedby={hint ? id + "-hint" : undefined} rows={rows} maxLength={limit} value={draft[name]} onChange={event => patch({ [name]: event.target.value })} />}
    </div>;
  }
  return <section className="admin-section programming">
    <div className="admin-section-heading">
      <div><span className="system-label">Programming / Convex</span><h2>Segments & schedule</h2></div>
      <p>Save a segment, add it to the rotation. Enabled slots play in order and repeat.</p>
    </div>
    {notice && <p className="programming-notice" role="status">{notice}</p>}
    <div className="programming-grid">
      <aside className="programming-library" aria-label="Segment library">
        <header><h3>Library <small>{library.segments.length}</small></h3><button disabled={busy} onClick={() => select(blank())}>+ New</button></header>
        {library.segments.map(segment => <button key={segment.id} disabled={busy} className={draft?.id === segment.id ? "is-selected" : ""} onClick={() => select(segment)}>
          <strong>{segment.title}</strong><small>{library.schedule.filter(entry => entry.segmentId === segment.id).length ? "In rotation" : "Draft"}</small>
        </button>)}
        {!library.segments.length && <p>Saved segments appear here and in the workshop.</p>}
        <Link href="/">Open generation workshop</Link>
      </aside>
      <div className="programming-editor">
        {!draft ? <p>Loading segment library...</p> : <fieldset disabled={busy}>
          <header><h3>{draft.persisted ? "Edit segment" : "New segment"}</h3><span>{dirty ? "Unsaved changes" : draft.persisted ? "Saved in Convex" : "Not saved"}</span></header>
          {field("title", 100, 1)}
          <label htmlFor="segment-chunk-seconds">Chunk length
            <select id="segment-chunk-seconds" value={draft.chunkSeconds ?? ""} onChange={event => patch({ chunkSeconds: event.target.value ? Number(event.target.value) : undefined })}>
              <option value="">Use global default ({defaultChunkSeconds} seconds)</option>
              {Array.from({ length: 9 }, (_, i) => i + 6).map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
            </select>
            <small>Overrides this segment only. Changes take effect the next time it starts. Reactor snaps duration to its frame grid.</small>
          </label>
          <div className="programming-frame" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) void attach(event.dataTransfer.files[0]); }}>
            {draft.openingFrame ? <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={draft.openingFrame.dataUrl} alt="Segment opening frame" />
              <button onClick={() => patch({ openingFrame: undefined })}>Remove frame</button>
            </> : <label>Opening frame <small>Optional. Drop an image or browse.</small><input aria-label="Opening frame" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void attach(event.target.files?.[0])} /></label>}
          </div>
          {field("direction", 800, 5, draft.direction.length + "/800")}
          {field("continuity", 1600, 5, "Show identity and facts that stay true across chunks.")}
          <details key={draft.id} className="programming-advanced">
            <summary>Advanced generation <small>Optional / Beta</small></summary>
            <p>Experimental guidance for enrichment and generation. All three fields are optional. Leave them blank to work from your starting prompt and continuity notes.</p>
            {field("voicePrompt", 360, 3, "Describe how each character sounds, not words they should say.", true)}
            {field("experience", 1200, 3, "Extra premise, tone or intent used when enriching a field. Not sent directly to the video model.", true)}
            {field("imageAnalysis", 6000, 3, "A visual description of the opening frame used as enrichment context. Attach a frame to generate it.", true)}
          </details>
          <footer><button className="programming-primary" onClick={() => void save()}>{busy ? "Saving..." : "Save segment"}</button></footer>
        </fieldset>}
      </div>
      <aside className="programming-schedule" aria-label="Segment schedule">
        <header><h3>Rotation</h3><span>Loops continuously</span></header>
        <button className="programming-primary" disabled={busy || dirty || !draft?.persisted || !draft.direction.trim()} onClick={() => void editSchedule({ operation: "add", segmentId: draft?.id })}>+ Schedule selected segment</button>
        <p className="programming-hint">Save edits before adding. Durations round up to the next chunk boundary.</p>
        <ol>{library.schedule.map((entry, index) => <li key={entry._id} className={entry.enabled ? "" : "is-paused"}>
          <header><span>{String(index + 1).padStart(2, "0")}</span><button disabled={busy} onClick={() => { const segment = library.segments.find(item => item.id === entry.segmentId); if (segment) select(segment); }}>{entry.title}</button></header>
          <label className="programming-duration">Duration (seconds)<input key={entry.durationSeconds} aria-label={entry.title + " duration"} type="number" min={30} max={3600} defaultValue={entry.durationSeconds} disabled={busy} onBlur={event => { const value = Number(event.target.value); if (value !== entry.durationSeconds) { if (Number.isInteger(value) && value >= 30 && value <= 3600) void editSchedule({ operation: "update", id: entry._id, durationSeconds: value }); else { event.target.value = String(entry.durationSeconds); setNotice("Duration must be 30 to 3600 seconds"); } } }} /></label>
          <footer><label><input type="checkbox" checked={entry.enabled} disabled={busy} onChange={event => void editSchedule({ operation: "update", id: entry._id, enabled: event.target.checked })} /> Enabled</label>
            <button aria-label={"Move " + entry.title + " up"} disabled={busy || index === 0} onClick={() => void editSchedule({ operation: "up", id: entry._id })}>↑</button>
            <button aria-label={"Move " + entry.title + " down"} disabled={busy || index === library.schedule.length - 1} onClick={() => void editSchedule({ operation: "down", id: entry._id })}>↓</button>
            <button title="Remove slot, keep segment in library" disabled={busy} onClick={() => void editSchedule({ operation: "remove", id: entry._id })}>Remove</button>
          </footer>
        </li>)}</ol>
        {!library.schedule.length && <p>No segments scheduled. Add a saved segment to start the rotation.</p>}
      </aside>
    </div>
    {enrichField && draft && <EnrichDialog field={enrichField} draft={draft} defaultChunkSeconds={defaultChunkSeconds}
      onClose={() => setEnrichField(null)} onApply={(name, value) => { patch({ [name]: value }); setEnrichField(null); setNotice("Field enriched. Review it, then save the segment."); }} />}
  </section>;
}
