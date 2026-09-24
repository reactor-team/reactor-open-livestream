"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "livekit-client";
import { backendFetch } from "@/lib/backend-fetch";
import { connectViewer } from "./viewer-connection";
import { captureStreamEvent } from "@/lib/analytics";

const identityKey = "reactor-infinite-identity";
const nameKey = "reactor-infinite-name";

function localValue(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function useViewer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const roomRef = useRef<Room | null>(null);
  const [identity, setIdentity] = useState("");
  const [legacyName, setLegacyName] = useState("");
  const [connection, setConnection] = useState<"connecting" | "live" | "offline">("connecting");
  const [viewerCount, setViewerCount] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolumeState] = useState(0.8);

  useEffect(() => {
    let cancelled = false;
    let value = localValue(identityKey);
    if (!/^[a-f0-9]{12,32}$/.test(value)) {
      value = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
      try { localStorage.setItem(identityKey, value); } catch { /* Keep this tab usable without storage. */ }
    }
    const storedName = localValue(nameKey) || `Viewer_${value.slice(0, 6)}`;
    queueMicrotask(() => {
      if (cancelled) return;
      setIdentity(value);
      setLegacyName(storedName);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!identity) return;
    return connectViewer({
      fetchToken: backendFetch as typeof fetch,
      identity,
      audio: () => audioRef.current,
      video: () => videoRef.current,
      onConnection: setConnection,
      onCount: setViewerCount,
      onRoom: room => { roomRef.current = room; },
    });
  }, [identity]);

  const enableSound = useCallback(() => {
    captureStreamEvent("sound_changed", { action: "enable" });
    const audio = audioRef.current;
    if (audio) {
      audio.muted = false;
      audio.volume = volume;
      void audio.play().catch(() => undefined);
    }
    void roomRef.current?.startAudio().catch(() => undefined);
    setMuted(false);
    setSoundEnabled(true);
  }, [volume]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    captureStreamEvent("sound_changed", { action: next ? "mute" : "unmute" });
    if (audioRef.current) audioRef.current.muted = next;
    setMuted(next);
  }, [muted]);

  const setVolume = useCallback((next: number) => {
    const safe = Math.min(1, Math.max(0, next));
    setVolumeState(safe);
    if (audioRef.current) audioRef.current.volume = safe;
  }, []);

  return {
    audioRef,
    connection,
    enableSound,
    identity,
    muted,
    legacyName,
    setVolume,
    soundEnabled,
    toggleMute,
    videoRef,
    viewerCount,
    volume,
  };
}
