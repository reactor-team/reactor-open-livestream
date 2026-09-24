import assert from "node:assert/strict";
import test from "node:test";
import { PromptDebugLog } from "../src/prompt-debug";

test("inspector retains exact compiled text and flags but never credentials or uploaded files", () => {
  const log = new PromptDebugLog();
  const frame = { upload_id: "private-upload", url: "private-url" };
  log.sent("trace", { prompt: "Keep the table still.", seconds: 10, metadata: '{"private":"secret"}', starting_frame: frame, ending_frame: frame, token: "secret" });
  log.accepted("trace", "clip");
  log.event("clip", "clip_started");
  const entry = log.snapshot()[0]!;
  assert.equal(entry.prompt, "Keep the table still.");
  assert.equal(entry.sameEndpoints, true);
  assert.equal(entry.state, "clip_started");
  assert.equal(entry.phase, "opening");
  assert.ok(!JSON.stringify(entry).includes("private"));
  assert.ok(!JSON.stringify(entry).includes("secret"));
  entry.prompt = "mutated";
  assert.equal(log.snapshot()[0]?.prompt, "Keep the table still.");
  for (let i = 0; i < 15; i++) log.sent(String(i), { prompt: "Action" });
  assert.equal(log.snapshot().length, 12);
  log.sent("continued", { prompt: "The conversation continues.", continue_from_clip_id: "clip" });
  assert.equal(log.snapshot()[0]?.phase, "continuation");
  log.clear();
  assert.equal(log.snapshot().length, 0);
});
