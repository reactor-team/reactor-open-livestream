import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { clipRange, clipFilename, clipTime, moveClipRange } from "../../../webapp/src/lib/clip-range";
import { exportLocalClip } from "../../../webapp/src/lib/local-clip-export";
import { isLocalSameOrigin } from "../../../webapp/src/lib/local-request";
import { LiveClipBuffer } from "../../../webapp/src/lib/live-clip-buffer";
import { assembleClip } from "../../../webapp/src/lib/browser-clip-export";

test("clip ranges preserve bounds, reject invalid input and cap length", () => {
  assert.deepEqual(clipRange(3, 18, 60), { start: 3, end: 18 });
  for (const range of [[-1, 10, 60], [0, 61, 70], [0, Infinity, 60], [2, 1, 60], [0, 0.5, 60], [0, 8, 7], [NaN, 10, 60]]) assert.equal(clipRange(...range as [number, number, number]), null);
  assert.equal(clipTime(59.95), "1:00.0");
  assert.equal(clipTime(0), "0:00.0");
  assert.equal(clipFilename("../../ Hey / friends!"), "Hey-friends.mp4");
  assert.equal(clipFilename(""), "reactor-tv-clip.mp4");
});

test("moving a clip selection preserves its length and clamps at both ends", () => {
  assert.deepEqual(moveClipRange(10, 25, 5, 60), { start: 15, end: 30 });
  assert.deepEqual(moveClipRange(10, 25, -3, 60), { start: 7, end: 22 });
  assert.deepEqual(moveClipRange(10, 25, 0, 60), { start: 10, end: 25 });
  assert.deepEqual(moveClipRange(10, 25, -100, 60), { start: 0, end: 15 });
  assert.deepEqual(moveClipRange(10, 25, 100, 60), { start: 45, end: 60 });
  assert.deepEqual(moveClipRange(0, 60, 12, 60), { start: 0, end: 60 });
  assert.deepEqual(moveClipRange(0, 1, -1, 60), { start: 0, end: 1 });
  for (const delta of [-100, -0.1, 0, 0.1, 1, 100]) {
    const next = moveClipRange(2.3, 9.9, delta, 60.04)!;
    assert.ok(next.start >= 0 && next.end <= 60.04);
    assert.ok(Math.abs(next.end - next.start - 7.6) < 1e-10);
  }
  // Each pointer move uses the initial range, so reversing an overshoot restores the grab offset.
  assert.deepEqual(moveClipRange(10, 25, 4, 60), { start: 14, end: 29 });
  for (const delta of [NaN, Infinity, -Infinity]) assert.equal(moveClipRange(10, 25, delta, 60), null);
  assert.equal(moveClipRange(25, 10, 1, 60), null);
  assert.equal(moveClipRange(0, 0, 1, 0), null);
});

test("local exporter bounds file inputs before processing", async () => {
  await assert.rejects(exportLocalClip([]), /72 MB/);
  await assert.rejects(exportLocalClip([new File([], "empty.webm")]), /72 MB/);
  await assert.rejects(exportLocalClip(Array.from({ length: 9 }, () => new File(["x"], "x"))), /72 MB/);
});

test("browser assembly rejects empty, oversized and canceled inputs before reading media", async () => {
  await assert.rejects(assembleClip([], new AbortController().signal), /too large/);
  await assert.rejects(assembleClip([new Blob()], new AbortController().signal), /too large/);
  await assert.rejects(assembleClip(Array.from({ length: 9 }, () => new Blob(["x"])), new AbortController().signal), /too large/);
  await assert.rejects(assembleClip([new Blob(["x"])], AbortSignal.abort()), /abort/i);
});

test("local origin checks handle dev bind addresses without accepting foreign sites", () => {
  const request = (origin: string, host = "localhost:3000") => new Request("http://0.0.0.0:3000/api/dev/clips", { headers: { origin, host } });
  assert.equal(isLocalSameOrigin(request("http://localhost:3000")), true);
  assert.equal(isLocalSameOrigin(request("http://localhost:3001")), false);
  assert.equal(isLocalSameOrigin(request("https://attacker.test")), false);
  assert.equal(isLocalSameOrigin(request("https://attacker.test", "attacker.test")), false);
  assert.equal(isLocalSameOrigin(request("null")), false);
  assert.equal(isLocalSameOrigin(new Request("http://localhost:3000")), false);
});

test("capture rolls bounded complete blocks and never stops the viewer's original track", async () => {
  const descriptors = Object.fromEntries(["performance", "MediaRecorder", "MediaStream"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let now = 0;
  let originalStops = 0;
  let cloneStops = 0;
  const original = { readyState: "live", kind: "video", stop: () => { originalStops++; }, clone: () => ({ stop: () => { cloneStops++; } }) };
  class Recorder {
    static isTypeSupported() { return true; }
    state = "inactive";
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["complete-video"]) }); queueMicrotask(() => this.onstop?.()); }
  }
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => now } });
  Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: Recorder });
  Object.defineProperty(globalThis, "MediaStream", { configurable: true, value: class {} });
  const buffer = new LiveClipBuffer(() => [original as unknown as MediaStreamTrack]);
  try {
    buffer.start();
    await assert.rejects(buffer.snapshot(), /few seconds/);
    for (let index = 0; index < 9; index++) {
      now += 12_000;
      const parts = await buffer.snapshot();
      assert.ok(parts.length <= 6);
      assert.ok(parts.every(part => part.size > 0));
    }
    assert.equal(buffer.seconds, 60);
    assert.equal(originalStops, 0);
  } finally {
    buffer.dispose();
    await Promise.resolve();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
  assert.ok(cloneStops >= 9);
  assert.equal(originalStops, 0);
});

test("local MP4 export keeps audio, trims duration and handles unfinished WebM duration", { skip: process.env.CLIP_FFMPEG_TEST !== "1" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "reactor-clip-test-"));
  const exec = promisify(execFile);
  try {
    const fixture = join(directory, "fixture.webm");
    await exec("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "4", "-c:v", "libvpx", "-c:a", "libopus", "-live", "1", fixture]);
    const input = new File([await readFile(fixture)], "fixture.webm");
    const result = await exportLocalClip([input, input], { start: 2, end: 7 });
    const output = join(directory, "result.mp4");
    await writeFile(output, result);
    const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,codec_type,width,height", "-of", "json", output]);
    const info = JSON.parse(stdout);
    assert.ok(Math.abs(Number(info.format.duration) - 5) < 0.2);
    assert.equal(info.streams.find((stream: { codec_type: string }) => stream.codec_type === "video").codec_name, "h264");
    assert.equal(info.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio").codec_name, "aac");
    const joined = await assembleClip([input, input], new AbortController().signal);
    const joinedPath = join(directory, "joined.webm");
    await writeFile(joinedPath, new Uint8Array(await joined.arrayBuffer()));
    const { stdout: joinedInfo } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,codec_type", "-of", "json", joinedPath]);
    const joinedData = JSON.parse(joinedInfo);
    assert.ok(Math.abs(Number(joinedData.format.duration) - 8) < 0.2);
    assert.equal(joinedData.streams.find((stream: { codec_type: string }) => stream.codec_type === "video").codec_name, "vp8");
    assert.equal(joinedData.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio").codec_name, "opus");
    await exec("ffmpeg", ["-nostdin", "-v", "error", "-i", joinedPath, "-f", "null", "-"]);
    await assert.rejects(exportLocalClip([input], { start: 3, end: 8 }), /between 1 and 60/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
