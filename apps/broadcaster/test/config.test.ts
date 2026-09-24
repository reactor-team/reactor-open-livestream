import assert from "node:assert/strict";
import test from "node:test";

import { readConfig } from "../src/config";

test("manual development mode starts idle without service credentials", () => {
  const config = readConfig({ BROADCASTER_MANUAL: "1" });
  assert.equal(config.BROADCASTER_MANUAL, true);
  assert.equal(config.LIVEKIT_ROOM, "reactor-tv-dev");
  assert.equal(config.CEREBRAS_MODEL, "qwen-3.8-27b");
  assert.equal(config.CEREBRAS_REASONING_EFFORT, "low");
  assert.equal("DEFAULT_PROMPT" in config, false);
});

test("production mode refuses incomplete configuration", () => {
  assert.throws(() => readConfig({ BROADCASTER_MANUAL: "0" }));
});

test("production mode accepts the complete service contract", () => {
  const config = readConfig({
    BROADCASTER_MANUAL: "0",
    BROADCASTER_SECRET: "a-long-development-secret",
    CEREBRAS_API_KEY: "csk_example",
    CONVEX_URL: "https://example.convex.cloud",
    LIVEKIT_API_KEY: "key",
    LIVEKIT_API_SECRET: "secret",
    LIVEKIT_URL: "wss://example.livekit.cloud",
    REACTOR_API_KEY: "rk_example",
  });
  assert.equal(config.BROADCASTER_MANUAL, false);
  assert.equal(config.REACTOR_MODEL, "reactor/fast-h3");
});

test("story planning must time out before the current clip ends", () => {
  assert.throws(() => readConfig({
    BROADCASTER_MANUAL: "1",
    CLIP_SECONDS: "6",
    CEREBRAS_TIMEOUT_MS: "6000",
  }));
});
