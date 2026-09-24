export const QUEUE_COUNT_DURATION_MS = 280;

export function hasQueueAddition(previous: readonly string[] | undefined, next: readonly string[] | undefined): boolean {
  if (!previous || !next) return false;
  const known = new Set(previous);
  return next.some(id => !known.has(id));
}

export function queuedPromptDescription(count: number | undefined): string {
  return count === undefined ? "Loading prompt queue" : count + " prompt" + (count === 1 ? "" : "s") + " queued";
}

/** A bounded tween that can restart from the last displayed value. */
export function animateQueueCount(from: number, to: number, options: {
  now: () => number;
  requestFrame: (callback: (time: number) => void) => number;
  cancelFrame: (id: number) => void;
  show: (value: number) => void;
  immediate?: boolean;
}): () => void {
  const began = options.now();
  let frame = 0;
  let cancelled = false;
  const tick = (time: number) => {
    if (cancelled) return;
    const progress = options.immediate ? 1 : Math.min(1, Math.max(0, (time - began) / QUEUE_COUNT_DURATION_MS));
    options.show(Math.round(from + (to - from) * (1 - (1 - progress) ** 3)));
    if (progress < 1) frame = options.requestFrame(tick);
  };
  frame = options.requestFrame(tick);
  return () => { cancelled = true; options.cancelFrame(frame); };
}
