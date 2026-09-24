"use client";

import { useEffect, useRef } from "react";
import { STATIC_FADE_MS, STATIC_FRAME_MS, STATIC_TILE_SIZE, staticTile } from "../../lib/signal-noise";

/** Quiet static crossfades into decoded video, then stops painting. */
export default function SignalStatic({ ready = false }: { ready?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.hidden = false;
    const fadeEndsAt = performance.now() + STATIC_FADE_MS;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const patterns = Array.from({ length: 8 }, (_, seed) => {
      const tile = document.createElement("canvas");
      tile.width = tile.height = STATIC_TILE_SIZE;
      const tileContext = tile.getContext("2d")!;
      const pixels = tileContext.createImageData(STATIC_TILE_SIZE, STATIC_TILE_SIZE);
      pixels.data.set(staticTile(seed));
      tileContext.putImageData(pixels, 0, 0);
      return context.createPattern(tile, "repeat")!;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const paint = () => {
      clearTimeout(timer);
      if (ready && (motion.matches || performance.now() >= fadeEndsAt)) {
        canvas.hidden = true;
        return;
      }
      if (document.hidden) return;
      context.fillStyle = patterns[motion.matches ? 0 : frame++ % patterns.length];
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (!motion.matches) timer = setTimeout(paint, ready ? Math.min(STATIC_FRAME_MS, Math.max(0, fadeEndsAt - performance.now())) : STATIC_FRAME_MS);
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const scale = Math.min(1, 1600 / Math.max(1, bounds.width));
      canvas.width = Math.max(1, Math.ceil(bounds.width * scale));
      canvas.height = Math.max(1, Math.ceil(bounds.height * scale));
      paint();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    motion.addEventListener("change", paint);
    document.addEventListener("visibilitychange", paint);
    resize();
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      motion.removeEventListener("change", paint);
      document.removeEventListener("visibilitychange", paint);
    };
  }, [ready]);
  return <canvas ref={canvasRef} className="signal-static" data-ready={ready || undefined} style={{ transitionDuration: `${STATIC_FADE_MS}ms` }} aria-hidden="true" />;
}
