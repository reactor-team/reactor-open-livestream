import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import { createMediaProgressProbe, type MediaHealthSample } from "../src/media-health";
import * as alerts from "../../../webapp/convex/streamAlerts";
import { OUTAGE_THRESHOLD_MS, postSlackAlert, slackAlertUserIds, slackOutageMessage, slackWebhookUrl } from "../../../webapp/convex/lib/streamAlerts";

const run = (fn: any, ctx: any, args: object = {}) => fn._handler(ctx, args);
const webhook = "https://hooks.slack.com/services/T_TEST/B_TEST/TEST_SECRET";

function fixture(t: test.TestContext) {
  let now = 100_000;
  const clock = Date.now;
  const secret = process.env.BROADCASTER_SECRET;
  const originalWebhook = process.env.SLACK_STREAM_WEBHOOK_URL;
  Date.now = () => now;
  process.env.BROADCASTER_SECRET = "test-broadcaster-secret";
  process.env.SLACK_STREAM_WEBHOOK_URL = webhook;
  t.after(() => {
    Date.now = clock;
    if (secret === undefined) delete process.env.BROADCASTER_SECRET; else process.env.BROADCASTER_SECRET = secret;
    if (originalWebhook === undefined) delete process.env.SLACK_STREAM_WEBHOOK_URL; else process.env.SLACK_STREAM_WEBHOOK_URL = originalWebhook;
  });
  const tables = new Map<string, any[]>();
  const table = (name: string) => { if (!tables.has(name)) tables.set(name, []); return tables.get(name)!; };
  let counter = 0;
  const jobs: { at: number; name: string; args: any }[] = [];
  const db = {
    query(name: string) {
      let rows = table(name);
      const q = {
        withIndex(_name: string, filter?: (q: any) => unknown) {
          const index = { eq(k: string, v: unknown) { rows = rows.filter(r => r[k] === v); return index; } };
          filter?.(index); return q;
        },
        unique: async () => { assert.ok(rows.length <= 1); return structuredClone(rows[0] ?? null); },
        order: () => q, take: async (n: number) => structuredClone(rows.slice(-n).reverse()),
      };
      return q;
    },
    get: async (id: string) => structuredClone([...tables.values()].flat().find(r => r._id === id) ?? null),
    insert: async (name: string, value: object) => { const id = `${name}_${++counter}`; table(name).push({ ...value, _id: id }); return id; },
    patch: async (id: string, value: object) => { const row = [...tables.values()].flat().find(r => r._id === id); assert.ok(row); Object.assign(row, value); },
  };
  table("broadcasts").push({ _id: "broadcast", key: "main", status: "live", startedAt: 90_000 });
  const ctx: any = { db, scheduler: { runAfter: async (delay: number, ref: any, args: object) => {
    jobs.push({ at: now + delay, name: getFunctionName(ref).split(":")[1], args });
    return `job_${jobs.length}`;
  } } };
  ctx.runMutation = (ref: any, args: object) => run((alerts as any)[getFunctionName(ref).split(":")[1]], ctx, args);
  return {
    ctx, jobs, table, now: () => now,
    tick: (ms: number) => { now += ms; },
    pulse: (healthy = true, overrides: object = {}) => run(alerts.pulse, ctx, {
      secret: "test-broadcaster-secret", sessionStartedAt: 90_000, observedAt: now, healthy, ...overrides,
    }),
    enable: () => run(alerts.configure, ctx, { enabled: true }),
    check: () => { const row = table("streamMonitor")[0]; return run(alerts.check, ctx, { epoch: row.epoch, deadline: row.nextCheckAt }); },
  };
}

test("video health needs advancing source and published frames during real playback", () => {
  const probe = createMediaProgressProbe();
  const sample = (input: number, output = input, extra: Partial<MediaHealthSample> = {}) => probe({
    connected: true, playing: true, incoming: [{ id: "source", frames: input }], outgoing: [{ id: "livekit", frames: output }], ...extra,
  });
  assert.equal(sample(10), false);
  assert.equal(sample(20), true);
  assert.equal(sample(20, 30), false);
  assert.equal(sample(30, 30), false);
  assert.equal(sample(40, 40, { connected: false }), false);
  assert.equal(sample(50, 50, { playing: false }), false);
  assert.equal(sample(60, 60), true);
  assert.equal(sample(1, 1), false);
  assert.equal(sample(2, 2), true);
  assert.equal(sample(3, 3, { incoming: [{ id: "new-source", frames: 1000 }] }), false);
  assert.equal(sample(4, 4, { incoming: [{ id: "new-source", frames: NaN }] }), false);
});

test("monitor is opt-in, requires a webhook and fresh publisher samples", async t => {
  const f = fixture(t);
  await assert.rejects(f.enable(), /fresh samples/);
  await f.pulse();
  assert.equal(f.table("streamMonitor")[0].enabled, false);
  assert.equal(f.jobs.length, 0);
  delete process.env.SLACK_STREAM_WEBHOOK_URL;
  await assert.rejects(f.enable(), /SLACK_STREAM_WEBHOOK_URL/);
  process.env.SLACK_STREAM_WEBHOOK_URL = webhook;
  await f.enable();
  assert.equal(f.jobs.length, 1);
  await f.enable();
  assert.equal(f.jobs.length, 1);
});

test("a dead publisher opens one incident strictly after five minutes", async t => {
  const f = fixture(t);
  assert.equal(OUTAGE_THRESHOLD_MS, 300_000);
  await f.pulse(); await f.enable();
  f.tick(OUTAGE_THRESHOLD_MS - 1); await f.check(); assert.equal(f.table("streamOutages").length, 0);
  f.tick(1); await f.check(); assert.equal(f.table("streamOutages").length, 0);
  f.tick(1); await f.check(); assert.equal(f.table("streamOutages").length, 1);
  f.tick(100_000); await f.check(); await f.pulse(false); await f.check();
  assert.equal(f.table("streamOutages").length, 1);
  assert.equal(f.jobs.filter(j => j.name === "deliver").length, 1);
});

test("a frozen video stays unhealthy even while process pulses continue", async t => {
  const f = fixture(t); await f.pulse(); await f.enable();
  for (let i = 0; i < OUTAGE_THRESHOLD_MS / 2000; i++) { f.tick(2000); await f.pulse(false); }
  assert.equal(f.table("streamOutages").length, 0);
  f.tick(1); await f.pulse(false);
  assert.equal(f.table("streamOutages").length, 1);
  assert.equal(f.table("streamMonitor")[0].lastHealthyAt, 100_000);
});

test("healthy pulses move the deadline without creating a scheduler per pulse", async t => {
  const f = fixture(t); await f.pulse(); await f.enable();
  const first = f.jobs[0];
  for (let i = 0; i < 6; i++) { f.tick(2000); await f.pulse(); }
  assert.equal(f.jobs.length, 1);
  await f.check(); assert.equal(f.jobs.length, 2);
  await run(alerts.check, f.ctx, first.args);
  assert.equal(f.jobs.length, 2);
  assert.equal(f.table("streamOutages").length, 0);
});

test("buffered media cannot hide a degraded public player", async t => {
  const f = fixture(t); await f.pulse(); await f.enable();
  await f.ctx.db.patch("broadcast", { status: "degraded" });
  for (let i = 0; i <= OUTAGE_THRESHOLD_MS / 2000; i++) { f.tick(2000); await f.pulse(); }
  assert.equal(f.table("streamOutages").length, 1);
  assert.equal(f.table("streamMonitor")[0].lastHealthyAt, 100_000);
});

test("late recovery cannot hide an outage, and needs four stable seconds before recovery", async t => {
  const f = fixture(t); await f.pulse(); await f.enable();
  const staleJob = f.jobs[0];
  f.tick(OUTAGE_THRESHOLD_MS + 1); await f.pulse();
  const incident = f.table("streamOutages")[0];
  assert.ok(incident); assert.equal(incident.recoveredAt, undefined);
  f.tick(2000); await f.pulse(false);
  f.tick(2000); await f.pulse();
  f.tick(2000); await f.pulse();
  assert.equal(incident.recoveredAt, undefined);
  f.tick(2000); await f.pulse();
  assert.equal(incident.recoveredAt, f.now() - 4000);
  assert.equal(f.table("streamMonitor")[0].incidentId, undefined);
  const jobs = f.jobs.length;
  await run(alerts.check, f.ctx, staleJob.args);
  assert.equal(f.jobs.length, jobs);
  f.tick(OUTAGE_THRESHOLD_MS + 1); await f.check();
  assert.equal(f.table("streamOutages").length, 2);
});

test("old sessions, stale buffered RPCs, out-of-order pulses and unauthorized callers cannot renew health", async t => {
  const f = fixture(t); await f.pulse(); await f.enable();
  f.tick(6000);
  for (const args of [{ sessionStartedAt: 1 }, { observedAt: 100_000 }, { observedAt: 110_000 }, { observedAt: NaN }]) {
    await f.pulse(true, args);
  }
  await assert.rejects(f.pulse(true, { secret: "wrong" }), /Unauthorized/);
  assert.equal(f.table("streamMonitor")[0].lastHealthyAt, 100_000);
  await f.ctx.db.patch("broadcast", { startedAt: 105_000 });
  await f.pulse(false, { sessionStartedAt: 105_000 });
  f.tick(OUTAGE_THRESHOLD_MS - 6000 + 1); await f.check();
  assert.equal(f.table("streamOutages").length, 1, "process restart cannot reset the outage deadline");
});

test("maintenance disables queued checks and deliveries, stale epochs cannot rearm", async t => {
  const f = fixture(t); await f.pulse(); await f.enable();
  const oldCheck = f.jobs[0];
  f.tick(OUTAGE_THRESHOLD_MS + 1); await f.check();
  const incidentId = f.table("streamOutages")[0]._id;
  await run(alerts.configure, f.ctx, { enabled: false });
  assert.equal(await run(alerts.claimDelivery, f.ctx, { incidentId, phase: "down" }), null);
  await run(alerts.check, f.ctx, oldCheck.args);
  f.tick(1); await f.pulse(); await f.enable();
  await run(alerts.check, f.ctx, oldCheck.args);
  assert.equal(f.table("streamOutages").length, 1);
  assert.equal(await run(alerts.claimDelivery, f.ctx, { incidentId, phase: "down" }), null);
});

test("delivery is claimed once, retries are bounded, stale completions cannot override new attempts", async t => {
  const f = fixture(t); await f.pulse(); await f.enable(); f.tick(OUTAGE_THRESHOLD_MS + 1); await f.check();
  const incidentId = f.table("streamOutages")[0]._id;
  const args = { incidentId, phase: "down" };
  const first = await run(alerts.claimDelivery, f.ctx, args);
  assert.equal(first.attempt, 1);
  assert.equal(await run(alerts.claimDelivery, f.ctx, args), null);
  await run(alerts.finishDelivery, f.ctx, { ...args, attempt: 1, ok: false, retryable: true, errorCode: "slack_unavailable" });
  assert.equal((await run(alerts.claimDelivery, f.ctx, args)).attempt, 2);
  await run(alerts.finishDelivery, f.ctx, { ...args, attempt: 1, ok: true, retryable: false });
  assert.equal(f.table("streamOutages")[0].down.state, "sending");
  await run(alerts.expireDelivery, f.ctx, { ...args, attempt: 2 });
  assert.equal((await run(alerts.claimDelivery, f.ctx, args)).attempt, 3);
  await run(alerts.finishDelivery, f.ctx, { ...args, attempt: 3, ok: false, retryable: true, errorCode: "slack_unavailable" });
  assert.equal(f.table("streamOutages")[0].down.state, "failed");
  assert.equal(await run(alerts.claimDelivery, f.ctx, args), null);
});

test("successful down alert precedes one quiet recovery and duplicate jobs cannot post again", async t => {
  const f = fixture(t); await f.pulse(); await f.enable(); f.tick(OUTAGE_THRESHOLD_MS + 1); await f.check();
  const incidentId = f.table("streamOutages")[0]._id;
  const originalFetch = globalThis.fetch;
  const posts: any[] = [];
  globalThis.fetch = async (_url, options) => { posts.push(JSON.parse(String(options?.body))); return new Response("ok"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  await f.pulse(); f.tick(2000); await f.pulse(); f.tick(2000); await f.pulse();
  assert.equal(await run(alerts.claimDelivery, f.ctx, { incidentId, phase: "recovery" }), null);
  await run(alerts.deliver, f.ctx, { incidentId, phase: "down" });
  await run(alerts.deliver, f.ctx, { incidentId, phase: "down" });
  await run(alerts.deliver, f.ctx, { incidentId, phase: "recovery" });
  await run(alerts.deliver, f.ctx, { incidentId, phase: "recovery" });
  assert.equal(posts.length, 2);
  assert.match(posts[0].text, /interrupted/); assert.match(posts[1].text, /recovered/);
  assert.doesNotMatch(posts[1].text, /<!/);
  assert.equal(f.table("streamOutages")[0].recovery.state, "sent");
});

test("Slack outage mentions only configured members and recovery never pings", () => {
  const recipients = " U012AB3CD, W012EF4GH, U012AB3CD ";
  assert.deepEqual(slackAlertUserIds(recipients), ["U012AB3CD", "W012EF4GH"]);
  const incident = { _id: "incident", startedAt: 1000 };
  const down = slackOutageMessage("down", incident, 301001, recipients);
  assert.ok(down.text.startsWith("<@U012AB3CD> <@W012EF4GH> *Reactor TV stream interrupted*"));
  assert.doesNotMatch(down.text, /<!/);
  assert.doesNotMatch(slackOutageMessage("recovery", incident, 301001, recipients).text, /<[@!]/);
  for (const invalid of ["", "none", "here", "channel", "everyone", "<!here>", "<@U012AB3CD>",
    "U012AB3CD,here", "U012AB3CD,", "U012AB3CD\n<!channel>", "u012ab3cd", "C012AB3CD",
    "U123", Array(11).fill("U012AB3CD").join(",")]) {
    assert.deepEqual(slackAlertUserIds(invalid), [], invalid);
    assert.doesNotMatch(slackOutageMessage("down", incident, 301001, invalid).text, /<[@!]/);
  }
});

test("private inspect reports the same member recipients used by delivery", async t => {
  const original = process.env.SLACK_STREAM_ALERT_MENTION;
  t.after(() => {
    if (original === undefined) delete process.env.SLACK_STREAM_ALERT_MENTION;
    else process.env.SLACK_STREAM_ALERT_MENTION = original;
  });
  const f = fixture(t);
  process.env.SLACK_STREAM_ALERT_MENTION = "U012AB3CD,W012EF4GH";
  const configured = await run(alerts.inspect, f.ctx);
  assert.equal(configured.mention, "users");
  assert.deepEqual(configured.mentionUserIds, ["U012AB3CD", "W012EF4GH"]);
  process.env.SLACK_STREAM_ALERT_MENTION = "here";
  const invalid = await run(alerts.inspect, f.ctx);
  assert.equal(invalid.mention, "none");
  assert.deepEqual(invalid.mentionUserIds, []);
});

test("Slack transport rejects redirects, sanitizes failures and respects rate-limit delay", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const payload = slackOutageMessage("down", { _id: "incident", startedAt: 1000 }, 12001, "U012AB3CD");
  assert.match(payload.text, /<@U012AB3CD>/);
  assert.doesNotMatch(slackOutageMessage("down", { _id: "i", startedAt: 1000 }, 12001, "<@arbitrary>").text, /<@/);
  globalThis.fetch = async (_url, options) => {
    assert.equal(options?.redirect, "error"); assert.ok(options?.signal);
    return new Response("secret arbitrary provider error", { status: 429, headers: { "retry-after": "12" } });
  };
  assert.deepEqual(await postSlackAlert(webhook, payload), { ok: false, retryable: true, errorCode: "slack_rate_limited", retryAfterMs: 12000 });
  globalThis.fetch = async () => new Response("invalid webhook", { status: 403 });
  assert.deepEqual(await postSlackAlert(webhook, payload), { ok: false, retryable: false, errorCode: "slack_rejected" });
  globalThis.fetch = async () => { throw new Error(`Failed ${webhook}`); };
  assert.deepEqual(await postSlackAlert(webhook, payload), { ok: false, retryable: true, errorCode: "slack_network_error" });
  assert.equal(slackWebhookUrl(webhook), webhook);
  for (const url of ["http://hooks.slack.com/services/A/B/C", "https://evil.example/services/A/B/C", `${webhook}?secret=1`, `${webhook}#x`, "https://user@hooks.slack.com/services/A/B/C", "https://hooks.slack.com.evil.example/services/A/B/C"]) {
    assert.equal(slackWebhookUrl(url), null);
  }
});
