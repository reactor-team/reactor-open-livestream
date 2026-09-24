import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CLIP_UPLOAD_BYTES, clipRange } from "./clip-range";

const exec = promisify(execFile);

/** Local editor adapter. Never runs in a deployed viewer or touches the publisher. */
export async function exportLocalClip(files: File[], range?: { start: number; end: number }, signal?: AbortSignal) {
  if (!files.length || files.length > 8 || files.some(file => !file.size) || files.reduce((sum, file) => sum + file.size, 0) > CLIP_UPLOAD_BYTES) {
    throw new Error("Choose up to 72 MB of recent stream video.");
  }
  const directory = await mkdtemp(join(tmpdir(), "reactor-tv-clip-"));
  try {
    let duration = 0;
    const paths: string[] = [];
    for (let index = 0; index < files.length; index++) {
      const path = join(directory, `source-${index}.webm`);
      await writeFile(path, new Uint8Array(await files[index].arrayBuffer()));
      const { stdout } = await exec("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration:stream=codec_type,width,height:packet=pts_time,duration_time", "-of", "json", path], { timeout: 15_000, maxBuffer: 4_000_000, signal });
      const info = JSON.parse(stdout) as { format: { duration?: string }; streams: { codec_type: string; width?: number; height?: number }[]; packets?: { pts_time?: string; duration_time?: string }[] };
      const video = info.streams.find(stream => stream.codec_type === "video");
      const seconds = Number(info.format.duration) || Math.max(0, ...(info.packets ?? []).map(packet => (Number(packet.pts_time) || 0) + (Number(packet.duration_time) || 0)));
      if (!video || !Number.isFinite(seconds) || seconds <= 0 || seconds > 100 || (video.width ?? 0) > 4096 || (video.height ?? 0) > 4096) throw new Error("This video could not be read. Capture another moment.");
      duration += seconds;
      paths.push(`file 'source-${index}.webm'\nduration ${seconds}`);
    }
    if (duration > 100) throw new Error("Capture at most 60 seconds of video.");
    const selected = range ? clipRange(range.start, range.end, duration) : { start: Math.max(0, duration - 60), end: duration };
    if (!selected) throw new Error("Choose a clip between 1 and 60 seconds.");
    const list = join(directory, "sources.txt");
    const output = join(directory, "clip.mp4");
    await writeFile(list, paths.join("\n"));
    await exec("ffmpeg", ["-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-f", "concat", "-safe", "1", "-i", list,
      "-ss", String(selected.start), "-t", String(selected.end - selected.start), "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-fs", String(CLIP_UPLOAD_BYTES), output],
      { timeout: 90_000, maxBuffer: 256_000, signal });
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
