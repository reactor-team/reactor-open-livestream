import assert from "node:assert/strict";
import test from "node:test";
import { PEACE_TALKS, moveTable, tableSceneInstruction } from "@reactor/infinite-contracts";
import { CerebrasStoryPlanner } from "../src/story-planner";
import { enqueuePayload } from "../src/continuity";

test("table begins at a normal size, opposing presses cancel and bounds clamp", () => {
  assert.equal(PEACE_TALKS.initialCm, 240);
  assert.equal(moveTable(moveTable(240, "lengthen"), "shorten"), 240);
  assert.equal(moveTable(PEACE_TALKS.minCm, "shorten"), PEACE_TALKS.minCm);
  assert.equal(moveTable(PEACE_TALKS.maxCm, "lengthen"), PEACE_TALKS.maxCm);
  assert.equal(moveTable(9990, "lengthen"), PEACE_TALKS.maxCm);
  assert.match(tableSceneInstruction({ runId: "run", lengthCm: 240, revision: 0 }, true), /Hold.*2.4m/);
});

test("shared geometry is reserved before scene assembly and native chaining survives", async () => {
  let request = "";
  const planner = new CerebrasStoryPlanner({
    apiKey: "test", model: "test", timeoutMs: 1000, clipSeconds: 10,
    fetchImpl: async (_url, init) => {
      request = String(init?.body);
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        visual: "The diplomats exchange an uncomfortable glance.",
        speaker: "", dialogue: "", sound: "Chairs scrape softly.", cast: [{ name: "Diplomat", voice: "British baritone" }],
      }) } }] });
    },
  });
  const table = { runId: "run-2", lengthCm: 1240, revision: 20 };
  const scene = await planner.plan({
    id: null, text: "Continue", author: "Reactor", table,
    continuityNotes: PEACE_TALKS.continuityNotes, voicePrompt: PEACE_TALKS.voicePrompt,
  }, []);
  assert.match(request, /Geometry reserves/);
  assert.match(request, /12.4m/);
  assert.ok(scene.videoPrompt.startsWith(tableSceneInstruction(table)));
  assert.ok(!scene.videoPrompt.includes(PEACE_TALKS.voicePrompt));
  assert.ok(scene.videoPrompt.length <= 800);
  const payload = enqueuePayload(scene, 10, "previous-clip", null);
  assert.equal(payload.continue_from_clip_id, "previous-clip");
  assert.deepEqual(JSON.parse(String(payload.metadata)).table, table);
  assert.ok(String(payload.metadata).length <= 2000);
  assert.ok(!String(payload.metadata).includes(PEACE_TALKS.continuityNotes));
});
