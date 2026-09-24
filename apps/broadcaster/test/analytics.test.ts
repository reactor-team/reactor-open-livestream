import assert from "node:assert/strict";
import test from "node:test";
import { analyticsEnabled, blockedPromptCategory, POSTHOG_PROJECT_TOKEN, safeEventProperties, safePostHogEvent, safePostHogProperties } from "../../../webapp/src/lib/analytics-policy";
import { StreamAnalytics } from "../../../webapp/src/lib/stream-analytics";

test("starter analytics remains disabled on every route", () => {
  assert.equal(analyticsEnabled("live.reactor.inc", "/", true), false);
  for (const host of ["localhost", "127.0.0.1", "starter.vercel.app", "preview.vercel.app"]) assert.equal(analyticsEnabled(host, "/", true), false);
  for (const path of ["/admin", "/admin/login", "/api/livekit/token", "/stream"]) assert.equal(analyticsEnabled("live.reactor.inc", path, true), false);
  assert.equal(analyticsEnabled("live.reactor.inc", "/", false), false);
});

test("the outbound allowlist drops text, credentials, URL queries and person profiles", () => {
  const safe = safePostHogProperties("reactor_tv:prompt_result", {
    source: "chat", outcome: "rejected", duration_ms: 123,
    prompt: "private prompt", body: "private chat", author: "reactor_intern", reason: "private policy",
    token: "secret", $current_url: "https://live.reactor.inc/?token=secret",
    $set: { email: "private@example.com" }, $initial_referrer: "https://example.com/private?secret=1",
    distinct_id: "0199aa01-abcd-1234-5678-00aa00bb00cc", $session_id: "session-123", $browser: "Chrome",
  });
  assert.equal(safe?.outcome, "rejected");
  assert.equal(safe?.$browser, "Chrome");
  assert.equal(safe?.$process_person_profile, false);
  assert.equal(safe?.$geoip_disable, true);
  assert.equal(safe?.app, "reactor_tv");
  assert.equal(safe?.environment, "production");
  for (const word of ["private", "secret", "reactor_intern", "@example.com"]) assert.equal(JSON.stringify(safe).includes(word), false);
  for (const event of ["$autocapture", "$pageview", "$snapshot", "$exception", "reactor_tv:unknown", "reactor_tv:__proto__"]) assert.equal(safePostHogProperties(event, {}), null);
});

test("event properties reject arbitrary values and invalid numbers", () => {
  assert.deepEqual(safeEventProperties("prompt_result", { outcome: "raw provider error", source: "user input", duration_ms: NaN }), {});
  assert.deepEqual(safeEventProperties("watch_time", { seconds: -2 }), {});
  assert.deepEqual(safeEventProperties("watch_time", { seconds: Infinity }), {});
  assert.equal(safePostHogProperties("reactor_tv:visit_started", { referrer_host: "https://www.google.com/search?q=secret" })?.referrer_host, "www.google.com");
  assert.equal(safePostHogProperties("reactor_tv:visit_started", { referrer_host: "" })?.referrer_host, "direct");
  assert.equal(blockedPromptCategory("Your previous prompt is #2 in queue."), "active_prompt");
  assert.equal(blockedPromptCategory("Choose a name above chat."), "name_required");
});

test("the complete SDK envelope retains its write-only routing token and drops top-level profiles", () => {
  const input = {
    event: "reactor_tv:visit_started", uuid: "event-id", timestamp: new Date(),
    properties: { distinct_id: "browser-id", token: "wrong-project" },
    $set: { email: "private@example.com" }, $set_once: { $initial_current_url: "https://example.com/?secret=yes" },
  };
  const output = safePostHogEvent(input);
  assert.equal(output?.properties.token, POSTHOG_PROJECT_TOKEN);
  assert.equal(output?.properties.distinct_id, "browser-id");
  assert.equal(output?.uuid, input.uuid);
  assert.equal(JSON.stringify(output).includes("private"), false);
  assert.equal(JSON.stringify(output).includes("secret"), false);
  assert.equal(JSON.stringify(output).includes("wrong-project"), false);
});

test("playback is counted once and interruptions recover without duplicate first plays", () => {
  const events: Array<{ event: string; properties: Record<string, string | number> }> = [];
  const analytics = new StreamAnalytics(100, (event, properties = {}) => events.push({ event, properties }));
  const sample = (at: number, ready: boolean) => analytics.sample({ at, ready, visible: true, mediaTime: at / 1000, reason: "connection" });
  sample(200, false); sample(1200, true); sample(2200, true);
  sample(3200, false); sample(4200, false); sample(5200, true);
  assert.equal(events.filter(row => row.event === "visit_started").length, 1);
  assert.deepEqual(events.filter(row => row.event === "playback_started").map(row => row.properties), [{ startup_ms: 1100 }]);
  assert.equal(events.filter(row => row.event === "playback_interrupted").length, 1);
  assert.deepEqual(events.find(row => row.event === "playback_resumed")?.properties, { interruption_ms: 2000 });
});

test("watch time counts only advancing visible video and never double flushes", () => {
  const seconds: number[] = [];
  const analytics = new StreamAnalytics(0, (event, properties) => { if (event === "watch_time") seconds.push(Number(properties?.seconds)); });
  const sample = (at: number, mediaTime: number, visible = true, ready = true) => analytics.sample({ at, mediaTime, visible, ready, reason: "broadcast" });
  sample(0, 0);
  for (let n = 1; n <= 30; n++) sample(n * 1000, n);
  assert.deepEqual(seconds, [30]);
  sample(31_000, 30); // Frozen video.
  sample(32_000, 31, false);
  sample(33_000, 32, false);
  sample(34_000, 33);
  sample(35_000, 34);
  sample(95_000, 94); // Sleeping laptop / throttled timer, not an hour of watching.
  sample(96_000, 0); // Media timeline reset.
  sample(97_000, 1, true, false);
  analytics.flush(); analytics.flush();
  assert.deepEqual(seconds, [30, 1]);
});
