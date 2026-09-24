type Part = { blob: Blob; seconds: number };
type Recording = { recorder: MediaRecorder; tracks: MediaStreamTrack[]; finish: () => Promise<Part | null>; started: number };

/** Short complete recordings stay seekable and bounded, unlike orphaned WebM fragments. */
export class LiveClipBuffer {
  private parts: Part[] = [];
  private active: Recording | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  private rotating = false;
  private failure = "";

  constructor(private source: () => MediaStreamTrack[]) {}

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 500);
  }

  get seconds() { return Math.min(60, this.parts.reduce((sum, part) => sum + part.seconds, 0) + (this.active ? (performance.now() - this.active.started) / 1000 : 0)); }
  get error() { return this.failure; }

  private tick() {
    if (this.disposed || this.rotating) return;
    if (this.active && performance.now() - this.active.started >= 12_000) void this.rotate();
    else if (!this.active) this.begin();
  }

  private begin() {
    if (this.disposed) return;
    const originals = this.source().filter(track => track.readyState === "live");
    if (!originals.some(track => track.kind === "video")) return;
    if (typeof MediaRecorder === "undefined") { this.failure = "Clipping is not supported in this browser. Try Chrome."; return; }
    const mimeType = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) { this.failure = "Clipping is not supported in this browser. Try Chrome."; return; }
    const tracks = originals.map(track => track.clone());
    try {
      const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 });
      const chunks: Blob[] = [];
      const started = performance.now();
      let bytes = 0;
      let failed = false;
      recorder.ondataavailable = event => {
        bytes += event.data.size;
        if (bytes > 12 * 1024 * 1024) { failed = true; this.failure = "The recording buffer filled up. Try capturing again."; if (recorder.state !== "inactive") recorder.stop(); }
        else if (event.data.size) chunks.push(event.data);
      };
      const stopped = new Promise<Part | null>(resolve => {
        recorder.onstop = () => {
          tracks.forEach(track => track.stop());
          const seconds = (performance.now() - started) / 1000;
          resolve(failed || seconds < 0.25 || !chunks.length ? null : { blob: new Blob(chunks, { type: mimeType }), seconds });
        };
        recorder.onerror = () => { failed = true; this.failure = "Couldn't buffer this stream. Refresh and try again."; };
      });
      recorder.start(1000);
      this.failure = "";
      this.active = { recorder, tracks, started, finish: () => { if (recorder.state !== "inactive") recorder.stop(); return stopped; } };
    } catch { tracks.forEach(track => track.stop()); this.failure = "Couldn't buffer this stream. Try Chrome or refresh the page."; }
  }

  private async rotate() {
    if (this.rotating) return;
    this.rotating = true;
    const active = this.active;
    this.active = null;
    try {
      const finished = active?.finish();
      this.begin();
      const part = await finished;
      if (part && !this.disposed) this.parts.push(part);
      while (this.parts.length > 6 || this.parts.reduce((sum, item) => sum + item.blob.size, 0) > 60 * 1024 * 1024) this.parts.shift();
    } finally { this.rotating = false; }
  }

  async snapshot(): Promise<Blob[]> {
    if (this.failure) throw new Error(this.failure);
    if (this.seconds < 2) throw new Error("Let the stream play for a few seconds, then clip it.");
    if (this.rotating) throw new Error("Finishing a recording block. Try again in a moment.");
    await this.rotate();
    if (!this.parts.length) throw new Error("No video was captured. Let the stream play, then try again.");
    return this.parts.map(part => part.blob);
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    void this.active?.finish();
    this.active = null;
    this.parts = [];
  }
}
