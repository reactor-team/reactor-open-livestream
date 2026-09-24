"use client";

import { RiArrowDownLine, RiCloseLine, RiPauseLine, RiPlayLine, RiScissorsCutLine } from "@remixicon/react";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clipFilename, clipRange, clipTime, moveClipRange } from "@/lib/clip-range";
import { prepareClip } from "@/lib/clip-client";

function ClipFilmstrip({ url }: { url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    const video = document.createElement("video");
    video.muted = true; video.preload = "auto"; video.src = url;
    const draw = async () => {
      const context = canvas.current?.getContext("2d");
      if (!context || !Number.isFinite(video.duration)) return;
      for (let index = 0; index < 10 && !cancelled; index++) {
        await new Promise<void>(resolve => {
          const timeout = setTimeout(resolve, 1500);
          video.onseeked = () => { clearTimeout(timeout); resolve(); };
          video.currentTime = Math.min(video.duration - 0.05, (index + 0.5) * video.duration / 10);
        });
        if (!cancelled && video.readyState >= 2) context.drawImage(video, index * 144, 0, 144, 80);
      }
    };
    video.onloadeddata = () => { void draw(); };
    return () => { cancelled = true; video.pause(); video.removeAttribute("src"); video.load(); };
  }, [url]);
  return <canvas ref={canvas} width="1440" height="80" aria-hidden="true" />;
}

export default function ClipEditor({ source, error: captureError, onClose }: {
  source: { blob: Blob; url: string } | null; error: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const video = useRef<HTMLVideoElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const exportRequest = useRef<AbortController | null>(null);
  const selectionDrag = useRef<{ pointerId: number; x: number; width: number; start: number; end: number } | null>(null);
  const [draggingSelection, setDraggingSelection] = useState(false);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [title, setTitle] = useState("Reactor TV clip");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.showModal();
    return () => { exportRequest.current?.abort(); queueMicrotask(() => { if (!node?.isConnected) focus?.focus(); }); };
  }, []);

  const seek = (at: number) => { if (video.current) video.current.currentTime = at; setPosition(at); };
  const move = (edge: "start" | "end", value: number) => {
    setSaved(false);
    if (edge === "start") { const next = Math.max(0, Math.min(end - 1, value)); setStart(next); seek(next); }
    else { const next = Math.min(duration, Math.max(start + 1, value)); setEnd(next); seek(Math.max(start, next - 0.15)); }
  };
  const fromPointer = (event: PointerEvent, edge: "start" | "end") => {
    const bounds = timeline.current?.getBoundingClientRect();
    if (bounds) move(edge, Math.round((event.clientX - bounds.left) / bounds.width * duration * 10) / 10);
  };
  const slideSelection = (initialStart: number, initialEnd: number, delta: number) => {
    const next = moveClipRange(initialStart, initialEnd, delta, duration);
    if (!next) return;
    video.current?.pause();
    setStart(next.start); setEnd(next.end); seek(next.start); setSaved(false);
  };
  const dragSelection = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = selectionDrag.current;
    if (!drag || drag.pointerId !== event.pointerId || exporting) return;
    const delta = Math.round((event.clientX - drag.x) / drag.width * duration * 10) / 10;
    slideSelection(drag.start, drag.end, delta);
  };
  const finishSelectionDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (selectionDrag.current?.pointerId !== event.pointerId) return;
    selectionDrag.current = null; setDraggingSelection(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const download = async () => {
    if (!source || exporting || !clipRange(start, end, duration)) return;
    setExporting(true); setExportProgress(0); setError(""); setSaved(false);
    const controller = new AbortController();
    exportRequest.current = controller;
    try {
      const blob = await prepareClip([source.blob], controller.signal, { start, end }, setExportProgress);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = clipFilename(title); anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setSaved(true);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Export failed. Try again."); }
    finally { if (!controller.signal.aborted) setExporting(false); }
  };

  return createPortal(<dialog ref={dialog} className="clip-editor" aria-labelledby="clip-editor-title" onCancel={onClose} onClose={onClose}
    onPointerDown={event => { backdropPress.current = event.target === event.currentTarget; }}
    onClick={event => { if (event.target === event.currentTarget && backdropPress.current) onClose(); backdropPress.current = false; }}>
    <div className="clip-editor-content">
      <header className="clip-editor-header"><h2 id="clip-editor-title"><RiScissorsCutLine aria-hidden="true" />Create a clip</h2><button type="button" className="clip-icon-button" aria-label="Close clip editor" onClick={onClose} autoFocus><RiCloseLine aria-hidden="true" /></button></header>
      {!source ? <div className="clip-preparing" role="status">{captureError ? <><p>{captureError}</p><button type="button" onClick={onClose}>Back to stream</button></> : <><div className="clip-loading-line" /><p>Preparing clip...</p></>}</div> : <>
        <div className="clip-preview"><video ref={video} src={source.url} playsInline controls={false}
          onLoadedMetadata={event => {
            const length = event.currentTarget.duration;
            if (!Number.isFinite(length) || length < 1) { setError("This moment was too short to clip. Try again after a few seconds."); return; }
            setDuration(length); setEnd(length); const beginning = Math.max(0, length - 30); setStart(beginning); seek(beginning);
          }}
          onTimeUpdate={event => { const player = event.currentTarget; setPosition(player.currentTime); if (player.currentTime >= end && end > 0) { player.pause(); seek(start); } }}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setError("This preview couldn't play. Try capturing another moment.")}
        /></div>
        <fieldset className="clip-editing" disabled={exporting}>
          <div className="clip-transport"><button className="clip-icon-button" type="button" aria-label={playing ? "Pause clip preview" : "Play clip preview"} disabled={!duration} onClick={() => {
            if (!video.current) return;
            if (playing) video.current.pause(); else { if (position < start || position >= end) seek(start); void video.current.play().catch(() => setError("Press play again to enable preview sound.")); }
          }}>{playing ? <RiPauseLine aria-hidden="true" /> : <RiPlayLine aria-hidden="true" />}</button><span>{clipTime(Math.max(0, position - start))}<span className="clip-time-divider">/</span>{clipTime(end - start)}</span></div>
          <div className="clip-timeline" ref={timeline}>
            <ClipFilmstrip url={source.url} />
            <div className="clip-outside" style={{ left: 0, width: `${duration ? start / duration * 100 : 0}%` }} />
            <div className="clip-outside" style={{ right: 0, width: `${duration ? (duration - end) / duration * 100 : 0}%` }} />
            <div className="clip-selection" style={{ left: `${duration ? start / duration * 100 : 0}%`, width: `${duration ? (end - start) / duration * 100 : 100}%` }}>
              <button type="button" className="clip-selection-move" data-dragging={draggingSelection || undefined} role="slider" aria-label="Move clip selection" aria-describedby="clip-range-help" aria-valuemin={0} aria-valuemax={Math.max(0, duration - (end - start))} aria-valuenow={start} aria-valuetext={`${clipTime(start)} to ${clipTime(end)}, ${(end - start).toFixed(1)} seconds selected`} disabled={!duration}
                onPointerDown={event => {
                  if (event.button !== 0 || !event.isPrimary || selectionDrag.current) return;
                  const bounds = timeline.current?.getBoundingClientRect();
                  if (!bounds?.width) return;
                  event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
                  selectionDrag.current = { pointerId: event.pointerId, x: event.clientX, width: bounds.width, start, end };
                  video.current?.pause(); setDraggingSelection(true);
                }}
                onPointerMove={dragSelection} onPointerUp={event => { dragSelection(event); finishSelectionDrag(event); }} onPointerCancel={finishSelectionDrag} onLostPointerCapture={finishSelectionDrag}
                onKeyDown={event => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || selectionDrag.current) return;
                  event.preventDefault();
                  slideSelection(start, end, event.key === "Home" ? -start : event.key === "End" ? duration - end : (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 0.1));
                }} />
              {(["start", "end"] as const).map(edge => <button key={edge} type="button" className={`clip-handle clip-handle-${edge}`} role="slider" aria-label={edge === "start" ? "Clip start" : "Clip end"} aria-valuemin={edge === "start" ? 0 : start + 1} aria-valuemax={edge === "start" ? Math.max(0, end - 1) : duration} aria-valuenow={edge === "start" ? start : end} aria-valuetext={clipTime(edge === "start" ? start : end)}
                onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); fromPointer(event, edge); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event, edge); }}
                onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const current = edge === "start" ? start : end; move(edge, event.key === "Home" ? 0 : event.key === "End" ? duration : current + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 0.1)); }}><span /></button>)}
            </div>
            <div className="clip-playhead" style={{ left: `${duration ? Math.min(duration, position) / duration * 100 : 0}%` }} />
          </div>
          <div className="clip-timeline-labels"><span>{clipTime(0)}</span><span>{clipTime(duration / 2)}</span><span>{clipTime(duration)}</span></div>
          <p id="clip-range-help" className="sr-only">Use Left and Right to move the selection, Shift for larger steps, or Home and End to jump to either end.</p>
          <div className="clip-range-row"><div aria-label="Clip length presets">{[15, 30, 60].map(seconds => <button type="button" key={seconds} aria-pressed={Math.abs(end - start - Math.min(seconds, duration)) < 0.1} onClick={() => { const next = Math.max(0, duration - seconds); setStart(next); setEnd(duration); seek(next); setSaved(false); }}>Last {seconds}s</button>)}</div></div>
          <label className="clip-title-label">Clip name<input value={title} maxLength={80} onChange={event => setTitle(event.target.value)} /></label>
          {error ? <p className="clip-error" role="alert">{error}</p> : null}
        </fieldset>
        <footer className="clip-editor-footer"><p role="status" className={exporting ? "sr-only" : undefined}>{exporting ? `Exporting ${Math.round(exportProgress * 100)}%` : saved ? "Download ready" : ""}</p><button className="clip-download" type="button" disabled={exporting || !duration || !clipRange(start, end, duration)} onClick={() => void download()}><RiArrowDownLine aria-hidden="true" />{exporting ? `Exporting ${Math.round(exportProgress * 100)}%` : "Download clip"}</button></footer>
      </>}
    </div>
  </dialog>, document.body);
}
