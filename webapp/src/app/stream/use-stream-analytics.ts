"use client";

import { useEffect, useRef, type RefObject } from "react";
import { captureStreamEvent } from "@/lib/analytics";
import { StreamAnalytics } from "@/lib/stream-analytics";

export function useStreamAnalytics(video: RefObject<HTMLVideoElement | null>, ready: boolean, status: string) {
  const state = useRef({ ready, status });
  useEffect(() => { state.current = { ready, status }; }, [ready, status]);
  useEffect(() => {
    const analytics = new StreamAnalytics(performance.now(), captureStreamEvent);
    const sample = () => analytics.sample({
      at: performance.now(), ready: state.current.ready, visible: document.visibilityState === "visible",
      mediaTime: video.current?.currentTime ?? 0,
      reason: state.current.status === "live" ? "connection" : "broadcast",
    });
    const leave = () => { sample(); analytics.flush(); };
    const interval = window.setInterval(sample, 1000);
    document.addEventListener("visibilitychange", sample);
    window.addEventListener("pagehide", leave);
    sample();
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", sample);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [video]);
}
