export const CLIP_WINDOW_SECONDS = 60;
export const CLIP_MIN_SECONDS = 1;
export const CLIP_UPLOAD_BYTES = 72 * 1024 * 1024;

export function clipRange(start: number, end: number, duration: number) {
  if (![start, end, duration].every(Number.isFinite) || duration < CLIP_MIN_SECONDS || duration > 100) return null;
  if (start < 0 || end > duration + 0.1 || end - start < CLIP_MIN_SECONDS || end - start > CLIP_WINDOW_SECONDS + 0.1) return null;
  return { start, end: Math.min(end, duration) };
}

export function moveClipRange(start: number, end: number, delta: number, duration: number) {
  const range = clipRange(start, end, duration);
  if (!range || !Number.isFinite(delta)) return null;
  const length = range.end - range.start;
  const lastStart = duration - length;
  const nextStart = Math.max(0, Math.min(lastStart, range.start + delta));
  return { start: nextStart, end: nextStart === lastStart ? duration : nextStart + length };
}

export function clipTime(seconds: number) {
  const tenths = Math.max(0, Math.round(seconds * 10));
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`;
}

export function clipFilename(title: string) {
  const safe = title.normalize("NFKD").replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "-").slice(0, 70);
  return `${safe || "reactor-tv-clip"}.mp4`;
}
