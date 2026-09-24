"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RiBugLine, RiCloseLine } from "@remixicon/react";

import { useBackend } from "../backend-context";
import { useDevMode } from "../dev-mode";
import BackendSelector from "./backend-selector";
import { backendFetch } from "@/lib/backend-fetch";

type Entry = {
  id: string; clipId: string | null; prompt: string; seconds: number;
  phase: string; state: string; at: number; startingFrame: boolean;
  endingFrame: boolean; sameEndpoints: boolean; continueFrom: string | null;
};
type Snapshot = { status: string; mode: string; entries: Entry[] };

export default function PromptInspector() {
  const backend = useBackend();
  const { enabled } = useDevMode();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  function restoreFocus() {
    const button = trigger.current;
    if (button?.getClientRects().length) button.focus({ preventScroll: true });
    else document.querySelector<HTMLButtonElement>(".viewer-menu-toggle")?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (!open || !enabled) return;
    close.current?.focus();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await backendFetch("/api/dev/stream/prompts", { cache: "no-store", signal: controller.signal });
        const next = await response.json();
        if (!response.ok) throw new Error(next.error || "Inspector unavailable");
        if (!Array.isArray(next.entries)) throw new Error("Restart the local broadcaster to enable prompt inspection");
        setData(next);
        setError("");
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Inspector unavailable");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 1000);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); restoreFocus(); }
    };
    window.addEventListener("keydown", escape);
    if (backend.target === "local") void refresh();
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener("keydown", escape); };
  }, [open, enabled, backend.target]);

  if (!backend.switchable || !enabled) return null;

  return <>
    <button ref={trigger} type="button" className="prompt-debug-toggle" aria-label="Debug prompts" aria-expanded={open} aria-controls="prompt-inspector" onClick={() => setOpen(value => !value)}>
      <RiBugLine aria-hidden="true" /><span>Debug{backend.target === "staging" ? " / Staging" : ""}</span>
    </button>
    {open ? createPortal(
      <section id="prompt-inspector" className="prompt-inspector" aria-label="Reactor prompt inspector">
        <header><div><small>LOCAL DEBUG</small><h2>Connection &amp; prompts</h2></div>
          <button ref={close} type="button" aria-label="Close prompt inspector" onClick={() => { setOpen(false); restoreFocus(); }}><RiCloseLine aria-hidden="true" /></button>
        </header>
        <BackendSelector />
        {backend.target === "staging" ? <p className="prompt-inspector-note">Exact enqueue inspection, Start/Stop and direct workshop overrides are local-only. Edit the staging schedule in Admin. The remote broadcaster keeps running independently.</p> : <>
        <p className="prompt-inspector-mode">{data?.mode || "Continuous"} · {data?.status || "Connecting"}</p>
        <p className="prompt-inspector-note">Exact enqueue text, not the original viewer request. Each chunk continues from the previous clip and is queued ahead.</p>
        {error ? <p role="alert">{error}</p> : null}
        <div className="prompt-inspector-scroll">
          {!data?.entries.length ? <p>No prompts captured in this session yet.</p> : data.entries.map(entry => (
            <article key={entry.id}>
              <div className="prompt-inspector-meta"><strong>{entry.phase}</strong><span>{entry.state.replace("clip_", "")} · {entry.seconds}s · {entry.prompt.length}/800 chars</span></div>
              <pre>{entry.prompt}</pre>
              <small>{entry.sameEndpoints ? "Identical first + last reference" : entry.continueFrom ? "Continues previous clip" : entry.startingFrame ? "Opening image" : "Text only"}</small>
              {entry.clipId ? <code>{entry.clipId}</code> : null}
            </article>
          ))}
        </div>
        </>}
      </section>, document.body,
    ) : null}
  </>;
}
