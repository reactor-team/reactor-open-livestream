export type SchedulePrompt = {
  _id: string;
  text: string;
  status: string;
  createdAt: number;
  _creationTime?: number;
  playNow?: boolean;
};

export type ScheduleNotice = { id: string; text: string; count: number };
export const SCHEDULE_NOTICE_HOLD_MS = 1100;
export const SCHEDULE_NOTICE_FLIGHT_MS = 500;
export const SCHEDULE_NOTICE_PULSE_MS = 220;

/** Scoop away from the target, then accelerate along a curved path into its center. */
export function scheduleNoticeFlight(x: number, y: number) {
  const direction = x < 0 ? -1 : 1;
  const bend = -direction * Math.min(44, Math.max(24, Math.abs(x) * .5));
  return Array.from({ length: 13 }, (_, index) => {
    const t = index / 12;
    const translateX = 2 * (1 - t) * t * bend + t * t * x;
    const translateY = 2 * (1 - t) * t * y * .12 + t * t * y;
    const scale = 1 - .94 * t * t;
    const rotate = direction * 8 * Math.sin(Math.PI * t);
    return {
      offset: t,
      transform: `translate(${translateX}px, ${translateY}px) rotate(${rotate}deg) scale(${scale})`,
      opacity: t < .35 ? 1 : Math.max(0, (1 - t) / .65),
    };
  });
}

/** Convex creation order separates new admissions from claims and recovery requeues. */
export class ScheduleArrivals {
  private initialized = false;
  private newest = -Infinity;
  private boundaryIds = new Set<string>();

  observe(prompts: readonly SchedulePrompt[] | undefined, notify = true): SchedulePrompt[] {
    if (!prompts) {
      this.initialized = false;
      return [];
    }
    const additions = prompts.filter(prompt => {
      const time = prompt._creationTime ?? prompt.createdAt;
      return time > this.newest || (time === this.newest && !this.boundaryIds.has(prompt._id));
    });
    for (const prompt of additions) {
      const time = prompt._creationTime ?? prompt.createdAt;
      if (time > this.newest) {
        this.newest = time;
        this.boundaryIds.clear();
      }
      if (time === this.newest) this.boundaryIds.add(prompt._id);
    }
    const announce = this.initialized && notify;
    this.initialized = true;
    return announce ? additions.filter(prompt => !prompt.playNow && (prompt.status === "pending" || prompt.status === "queued")) : [];
  }
}

/** Keep one readable excerpt while batching arrivals behind the current notification. */
export function batchScheduleNotice(pending: ScheduleNotice | null, arrivals: readonly SchedulePrompt[]): ScheduleNotice | null {
  if (!arrivals.length) return pending;
  return pending
    ? { ...pending, count: pending.count + arrivals.length }
    : { id: arrivals[0]._id, text: arrivals[0].text, count: arrivals.length };
}

export function scheduleNoticePosition(anchor: { right: number; bottom: number }, controlsBottom: number, size: { width: number; height: number }, viewport: { width: number; height: number }) {
  return {
    left: Math.max(12, Math.min(anchor.right - size.width, viewport.width - size.width - 12)),
    top: Math.max(12, Math.min(Math.max(anchor.bottom, controlsBottom) + 12, viewport.height - size.height - 12)),
  };
}
