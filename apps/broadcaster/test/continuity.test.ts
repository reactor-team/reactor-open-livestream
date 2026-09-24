import assert from "node:assert/strict";
import test from "node:test";

import { clipFromMessageData, continuityInput, enqueuePayload } from "../src/continuity";
import type { PlannedScene } from "../src/story-planner";

const scene: PlannedScene = {
  id: null,
  text: "Continue Morgan's show",
  author: "Reactor",
  videoPrompt: "Morgan catches the rolling tomato and slaps it onto the chopping board.",
  sceneSummary: "Morgan catches a tomato beside the copper pan.",
  dialogue: "Not today, you crimson menace!",
  plannerModel: "gpt-oss-120b",
  plannerLatencyMs: 120,
};

test("the opening clip uses Morgan's supplied starting frame", () => {
  const startingFrame = { id: "file-1" };
  assert.deepEqual(continuityInput(null, startingFrame), { starting_frame: startingFrame });
  const payload = enqueuePayload(scene, 10, null, startingFrame);
  assert.equal(payload.starting_frame, startingFrame);
  assert.equal(payload.continue_from_clip_id, undefined);
});

test("every later clip continues from the prior queued clip", () => {
  assert.deepEqual(continuityInput("clip-7", { id: "unused" }), {
    continue_from_clip_id: "clip-7",
  });
  const payload = enqueuePayload(scene, 10, "clip-7", null);
  assert.equal(payload.continue_from_clip_id, "clip-7");
  assert.equal(payload.starting_frame, undefined);
});

test("Reactor metadata contains only playback correlation fields", () => {
  const payload = enqueuePayload({
    ...scene,
    continuityNotes: "A long segment constitution that belongs in the Cerebras planner only.",
    openingFrameUrl: "https://example.test/private-frame",
    playNow: true,
  }, 10, null, {});
  assert.deepEqual(JSON.parse(String(payload.metadata)), {
    id: null,
    text: "Continue Morgan's show",
    author: "Reactor",
    startsSegment: false,
  });
  assert.ok(String(payload.metadata).length < 2_000);
});

test("segment openings are carried to the playback heartbeat", () => {
  const payload = enqueuePayload(scene, 10, null, {}, true);
  assert.equal(JSON.parse(String(payload.metadata)).startsSegment, true);
});

test("clip ids are read from Reactor command replies", () => {
  assert.deepEqual(clipFromMessageData({ clip: { clip_id: "clip-8" } }), { clip_id: "clip-8" });
  assert.equal(clipFromMessageData({ clip: {} }), null);
});
