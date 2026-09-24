import {
  ALL_FORMATS, BlobSource, BufferTarget, Conversion, EncodedAudioPacketSource,
  EncodedPacketSink, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output,
  WebMOutputFormat, canEncodeAudio, canEncodeVideo,
} from "mediabunny";
import { CLIP_UPLOAD_BYTES, CLIP_WINDOW_SECONDS, clipRange } from "./clip-range";

export type ClipProgress = (fraction: number) => void;

const inputFor = (blob: Blob) => new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
const unreadable = () => new Error("This recording couldn't be prepared. Capture another moment.");

/** Join complete local recording blocks without decoding or uploading their media. */
export async function assembleClip(files: Blob[], signal: AbortSignal, progress?: ClipProgress): Promise<Blob> {
  signal.throwIfAborted();
  if (!files.length || files.length > 8 || files.some(file => !file.size) || files.reduce((sum, file) => sum + file.size, 0) > CLIP_UPLOAD_BYTES) throw new Error("This recording is too large. Refresh and capture a shorter moment.");
  const inputs = files.map(inputFor);
  let output: Output<Mp4OutputFormat | WebMOutputFormat, BufferTarget> | undefined;
  const abort = () => { inputs.forEach(input => input.dispose()); if (output) void output.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const entries = [];
    for (const input of inputs) {
      const video = await input.getPrimaryVideoTrack();
      const audio = await input.getPrimaryAudioTrack();
      if (!video?.codec) throw unreadable();
      const first = await input.getFirstTimestamp();
      const duration = await input.computeDuration() - first;
      if (!Number.isFinite(duration) || duration <= 0 || duration > 60) throw unreadable();
      entries.push({ input, video, audio, first, duration });
      signal.throwIfAborted();
    }
    // Keep complete keyframe-led blocks so opening the editor is fast and lossless.
    let duration = entries.reduce((sum, entry) => sum + entry.duration, 0);
    while (duration > CLIP_WINDOW_SECONDS && entries.length > 1) duration -= entries.shift()!.duration;
    if (duration < 1) throw new Error("Let the stream play a few more seconds, then clip it.");
    const first = entries[0];
    const audioTrack = entries.find(entry => entry.audio)?.audio;
    const videoCodec = first.video.codec!;
    const audioCodec = audioTrack?.codec;
    if (entries.some(entry => entry.video.codec !== videoCodec || (entry.audio && entry.audio.codec !== audioCodec))) throw unreadable();
    const format = videoCodec === "avc" || videoCodec === "hevc" ? new Mp4OutputFormat() : new WebMOutputFormat();
    output = new Output({ format, target: new BufferTarget() });
    const videoSource = new EncodedVideoPacketSource(videoCodec);
    const audioSource = audioCodec ? new EncodedAudioPacketSource(audioCodec) : null;
    output.addVideoTrack(videoSource);
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();
    let offset = 0;
    for (const entry of entries) {
      signal.throwIfAborted();
      const videoConfig = await entry.video.getDecoderConfig();
      if (!videoConfig) throw unreadable();
      const videoSink = new EncodedPacketSink(entry.video);
      const firstPacket = await videoSink.getFirstPacket();
      if (!firstPacket || firstPacket.type !== "key") throw unreadable();
      await Promise.all([
        (async () => {
          for await (const packet of videoSink.packets()) {
            signal.throwIfAborted();
            await videoSource.add(packet.clone({ timestamp: packet.timestamp - entry.first + offset }), { decoderConfig: videoConfig });
          }
        })(),
        (async () => {
          if (!entry.audio || !audioSource) return;
          const config = await entry.audio.getDecoderConfig();
          if (!config) throw unreadable();
          for await (const packet of new EncodedPacketSink(entry.audio).packets()) {
            signal.throwIfAborted();
            await audioSource.add(packet.clone({ timestamp: packet.timestamp - entry.first + offset }), { decoderConfig: config });
          }
        })(),
      ]);
      offset += entry.duration;
      progress?.(Math.min(0.95, offset / duration));
    }
    await output.finalize();
    signal.throwIfAborted();
    if (!output.target.buffer || output.target.buffer.byteLength > CLIP_UPLOAD_BYTES) throw unreadable();
    progress?.(1);
    return new Blob([output.target.buffer], { type: format.mimeType });
  } finally {
    signal.removeEventListener("abort", abort);
    inputs.forEach(input => input.dispose());
    if (output && output.state !== "finalized") await output.cancel().catch(() => {});
  }
}

/** Selected-range H.264/AAC export, using browser codecs and a bundled AAC fallback. */
export async function exportBrowserClip(blob: Blob, range: { start: number; end: number }, signal: AbortSignal, progress?: ClipProgress) {
  signal.throwIfAborted();
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") throw new Error("MP4 export isn't supported in this browser. Try the latest Chrome.");
  const input = inputFor(blob);
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  let conversion: Conversion | undefined;
  const abort = () => { if (conversion) void conversion.cancel().catch(() => {}); input.dispose(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const duration = await input.computeDuration();
    const selected = clipRange(range.start, range.end, duration);
    if (!selected) throw new Error("Choose a clip between 1 and 60 seconds.");
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw unreadable();
    const width = Math.ceil(await video.getDisplayWidth() / 2) * 2;
    const height = Math.ceil(await video.getDisplayHeight() / 2) * 2;
    if (!(await canEncodeVideo("avc", { width, height }))) throw new Error("This browser can't export this video as MP4. Try the latest Chrome.");
    if (await input.getPrimaryAudioTrack() && !(await canEncodeAudio("aac"))) {
      const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
      registerAacEncoder();
    }
    signal.throwIfAborted();
    conversion = await Conversion.init({ input, output, trim: selected, tracks: "primary", tags: {},
      video: { codec: "avc", width, height, fit: "contain", forceTranscode: true },
      audio: { codec: "aac", sampleRate: 48000, forceTranscode: true },
    });
    signal.throwIfAborted();
    if (!conversion.isValid || conversion.discardedTracks.length) throw new Error("This browser couldn't export both video and sound. Try the latest Chrome.");
    conversion.onProgress = fraction => progress?.(Math.min(0.99, Math.max(0, fraction)));
    await conversion.execute();
    signal.throwIfAborted();
    if (!output.target.buffer || output.target.buffer.byteLength > CLIP_UPLOAD_BYTES) throw new Error("This clip is too large. Try a shorter selection.");
    progress?.(1);
    return new Blob([output.target.buffer], { type: "video/mp4" });
  } finally {
    signal.removeEventListener("abort", abort);
    if (conversion && conversion.state !== "done") await conversion.cancel().catch(() => {});
    input.dispose();
    if (output.state !== "finalized") await output.cancel().catch(() => {});
  }
}
