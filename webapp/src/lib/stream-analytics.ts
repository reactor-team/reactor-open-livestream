import type { EventProperties, StreamEvent } from "./analytics-policy";

type Sample = { at: number; ready: boolean; visible: boolean; mediaTime: number; reason: "connection" | "broadcast" };
type Capture = (event: StreamEvent, properties?: EventProperties) => void;

// Watch time is additive visible advancing-video time, never wall time on an idle tab.
export class StreamAnalytics {
  private previous: Sample | null = null;
  private started = false;
  private interruptedAt: number | null = null;
  private seconds = 0;
  constructor(private readonly openedAt: number, private readonly capture: Capture) {
    capture("visit_started");
  }
  sample(sample: Sample) {
    if (sample.ready && !this.started) {
      this.started = true;
      this.capture("playback_started", { startup_ms: Math.max(0, sample.at - this.openedAt) });
    }
    if (this.started && !sample.ready && this.interruptedAt === null) {
      this.interruptedAt = sample.at;
      this.capture("playback_interrupted", { reason: sample.reason });
    } else if (sample.ready && this.interruptedAt !== null) {
      this.capture("playback_resumed", { interruption_ms: Math.max(0, sample.at - this.interruptedAt) });
      this.interruptedAt = null;
    }
    const previous = this.previous;
    const elapsed = previous ? (sample.at - previous.at) / 1000 : 0;
    if (previous?.ready && previous.visible && sample.ready && sample.visible && elapsed > 0 && elapsed <= 5) {
      const advanced = sample.mediaTime - previous.mediaTime;
      if (Number.isFinite(advanced) && advanced > 0) this.seconds += Math.min(elapsed, advanced);
    }
    this.previous = sample;
    if (this.seconds >= 30 || !sample.visible || !sample.ready) this.flush();
  }
  flush() {
    const seconds = Math.round(this.seconds * 1000) / 1000;
    if (seconds > 0) this.capture("watch_time", { seconds });
    this.seconds = 0;
  }
}
