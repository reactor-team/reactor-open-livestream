"use client";

import { RiScissorsCutLine } from "@remixicon/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { LiveClipBuffer } from "@/lib/live-clip-buffer";
import { prepareClip } from "@/lib/clip-client";
import { PromptNotice } from "./private-prompt-message";
import ClipEditor from "./clip-editor";
import "./clips.css";

export default function ClipControls({ videoRef, audioRef, live }: {
  videoRef: RefObject<HTMLVideoElement | null>; audioRef: RefObject<HTMLAudioElement | null>; live: boolean;
}) {
  const buffer = useRef<LiveClipBuffer | null>(null);
  const request = useRef<AbortController | null>(null);
  const currentUrl = useRef("");
  const [source, setSource] = useState<{ blob: Blob; url: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ id: string; title: string; reason: string } | null>(null);

  useEffect(() => {
    if (!live) return;
    const stop = () => { buffer.current?.dispose(); buffer.current = null; };
    const syncVisibility = () => {
      if (document.hidden) { stop(); return; }
      if (buffer.current) return;
      const recording = new LiveClipBuffer(() => {
        const elements = [videoRef.current, audioRef.current];
        return elements.flatMap(element => element?.srcObject instanceof MediaStream ? element.srcObject.getTracks() : []);
      });
      buffer.current = recording;
      recording.start();
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => { document.removeEventListener("visibilitychange", syncVisibility); stop(); };
  }, [audioRef, videoRef, live]);

  useEffect(() => () => { request.current?.abort(); if (currentUrl.current) URL.revokeObjectURL(currentUrl.current); }, []);

  useEffect(() => {
    if (!open || !audioRef.current) return;
    const audio = audioRef.current;
    const muted = audio.muted;
    audio.muted = true;
    return () => { audio.muted = muted; };
  }, [audioRef, open]);

  const close = () => {
    request.current?.abort();
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = "";
    setOpen(false); setSource(null); setError("");
  };
  const capture = async () => {
    if (open) return;
    if (!buffer.current || buffer.current.seconds < 2 || buffer.current.error) {
      setNotice({ id: crypto.randomUUID(), title: "Not ready to clip", reason: buffer.current?.error || "Let the stream play for a few seconds, then capture a moment." });
      return;
    }
    setOpen(true); setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const files = await buffer.current.snapshot();
      const blob = await prepareClip(files, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      currentUrl.current = url;
      setSource({ blob, url });
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Couldn't capture this moment. Try again.");
    }
  };

  return <>
    <button className="clip-trigger" type="button" aria-label="Create a clip" aria-haspopup="dialog" title="Clip up to the last 60 seconds you've watched" onClick={() => void capture()}><RiScissorsCutLine aria-hidden="true" /><span>Clip</span></button>
    {open ? <ClipEditor source={source} error={error} onClose={close} /> : null}
    {notice ? <PromptNotice notice={notice} onDismiss={() => setNotice(null)} dismissLabel="Dismiss clip notification" /> : null}
  </>;
}
