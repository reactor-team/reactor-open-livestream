import assert from "node:assert/strict";
import test from "node:test";
import type { ScheduledSegment } from "@reactor/infinite-contracts";
import { nextScheduledScene, resolveChunkSeconds } from "../src/schedule";

const first: ScheduledSegment = { _id: "office", title: "The Office", text: "Michael sets down a suggestion box.",
  continuityNotes: "Office mockumentary", voicePrompt: "Michael: mid baritone", durationSeconds: 30, position: 1, enabled: true };
const second = { ...first, _id: "second", title: "Second segment", position: 2 };

test("schedule starts without a viewer prompt or reference image", () => {
  const scene = nextScheduledScene([second, first]);
  assert.equal(scene?.segment?.id, "office");
  assert.equal(scene?.startsSegment, true);
  assert.equal(scene?.id, null);
  assert.equal(scene?.openingFrameUrl, undefined);
  assert.equal(scene?.voicePrompt, first.voicePrompt);
});
test("schedule advances on accepted media duration, wraps and skips disabled entries", () => {
  const cursor = { id: first._id, title: first.title, durationSeconds: 30, elapsedSeconds: 20 };
  assert.equal(nextScheduledScene([first, second], cursor), null);
  assert.equal(nextScheduledScene([first, second], { ...cursor, elapsedSeconds: 30 })?.segment?.id, second._id);
  assert.equal(nextScheduledScene([first, second], { ...cursor, id: second._id, elapsedSeconds: 30 })?.segment?.id, first._id);
  assert.equal(nextScheduledScene([first, { ...second, enabled: false }], { ...cursor, elapsedSeconds: 30 })?.segment?.id, first._id);
  assert.equal(nextScheduledScene([{ ...first, enabled: false }]), null);
  assert.equal(nextScheduledScene([]), null);
});
test("single entry repeats, edits apply on next opening, removed cursor starts at first remaining entry", () => {
  const cursor = { id: first._id, title: first.title, durationSeconds: 30, elapsedSeconds: 30 };
  assert.equal(nextScheduledScene([first], cursor)?.segment?.id, first._id);
  assert.equal(nextScheduledScene([{ ...first, text: "Edited opening" }], cursor)?.text, "Edited opening");
  assert.equal(nextScheduledScene([second], cursor)?.segment?.id, second._id);
});

test("schedule passes the library frame and keeps slot identity for repeated segments", () => {
  const entries = [
    { ...first, segmentId: "shared", openingFrameUrl: "https://example.com/frame.png" },
    { ...second, segmentId: "shared", openingFrameUrl: "https://example.com/frame.png" },
  ];
  assert.equal(nextScheduledScene(entries)?.openingFrameUrl, entries[0].openingFrameUrl);
  const cursor = { id: first._id, title: first.title, durationSeconds: 30, elapsedSeconds: 30 };
  assert.equal(nextScheduledScene(entries, cursor)?.segment?.id, second._id);
});
test("chunk overrides apply on opening, persist for a run, and reset to the live default", () => {
  const cursor = { id: "office", title: "Office", durationSeconds: 120, elapsedSeconds: 14, chunkSeconds: 14 };
  assert.equal(resolveChunkSeconds(6, true, 14), 14);
  assert.equal(resolveChunkSeconds(8, false, undefined, cursor), 14);
  assert.equal(resolveChunkSeconds(8, true, undefined, cursor), 8);
  assert.equal(resolveChunkSeconds(12, false, undefined, { ...cursor, chunkSeconds: undefined }), 12);
  assert.equal(resolveChunkSeconds(10, true, 100), 10);
  assert.equal(nextScheduledScene([{ ...first, chunkSeconds: 8 }])?.segment?.chunkSeconds, 8);
});
