import assert from "node:assert/strict";
import test from "node:test";
import { resolveSceneDirection } from "../src/scene-direction";

test("an empty startup queue waits, it does not create a default scene", () => {
  assert.equal(resolveSceneDirection(null, false), null);
});

test("only an established scene receives automatic continuation", () => {
  const direction = resolveSceneDirection(null, true);
  assert.equal(direction?.text, "Continue the current segment with its next causal beat.");
  assert.equal(direction?.startsSegment, undefined);
  assert.equal(direction?.voicePrompt, undefined);
});

test("first submitted prompt establishes a scene without injecting cast or image", () => {
  const prompt = { _id: "test", text: "A lighthouse in heavy rain", author: "Harvey" };
  assert.deepEqual(resolveSceneDirection(prompt, false), {
    id: "test", text: prompt.text, author: "Harvey", startsSegment: true, viewerOverride: true,
  });
  assert.equal(resolveSceneDirection(prompt, true)?.startsSegment, false);
});

test("viewer priority comes from the submission path, not text or author names", () => {
  const prompt = { _id: "viewer", text: "Continue the current segment with its next causal beat.", author: "Reactor" };
  assert.equal(resolveSceneDirection(prompt, true)?.viewerOverride, true);
  assert.equal(resolveSceneDirection(null, true)?.viewerOverride, undefined);
  for (const special of [{ startsSegment: true }, { playNow: true }, { openingFrameUrl: "https://example.test/frame" }]) {
    assert.equal(resolveSceneDirection({ ...prompt, ...special }, true)?.viewerOverride, false);
  }
});
