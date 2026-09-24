"use client";

import { RiFullscreenExitLine, RiFullscreenLine } from "@remixicon/react";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { toggleBrowserFullscreen } from "@/lib/fullscreen";
import { PromptNotice } from "./private-prompt-message";
import { captureStreamEvent } from "@/lib/analytics";

function subscribe(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

const getSnapshot = () => Boolean(document.fullscreenElement);
const getServerSnapshot = () => false;

export default function FullscreenToggle() {
  const fullscreen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ id: string; title: string; reason: string } | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);

  async function toggle() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice(null);
    try {
      // Keep the native request inside the click's user activation.
      await toggleBrowserFullscreen(document);
      captureStreamEvent("fullscreen_result", { outcome: document.fullscreenElement ? "entered" : "exited" });
    } catch {
      captureStreamEvent("fullscreen_result", { outcome: "failed" });
      setNotice({
        id: String(Date.now()),
        title: "Couldn't switch fullscreen",
        reason: "Your browser didn't allow fullscreen. Try opening the site directly in Chrome or another fullscreen-capable browser.",
      });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <>
    <button
      className="fullscreen-toggle"
      type="button"
      aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      aria-pressed={fullscreen}
      disabled={busy}
      onClick={() => void toggle()}
      title={fullscreen ? "Exit fullscreen (Esc)" : "Enter fullscreen"}
    >
      {fullscreen ? <RiFullscreenExitLine aria-hidden="true" /> : <RiFullscreenLine aria-hidden="true" />}
    </button>
    {notice ? <PromptNotice notice={notice} onDismiss={dismissNotice} dismissLabel="Dismiss fullscreen notification" /> : null}
  </>;
}
