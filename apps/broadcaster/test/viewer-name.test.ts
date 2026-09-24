import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import { readFileSync } from "node:fs";
import { isGenericViewerName, nameChangeWait, viewerNameError, VIEWER_NAME_MISMATCH, VIEWER_NAME_REQUIRED, VIEWER_NAME_COOLDOWN_MS } from "@reactor/infinite-contracts";
import * as viewers from "../../../webapp/convex/viewers";
import * as chat from "../../../webapp/convex/chat";
import * as prompts from "../../../webapp/convex/prompts";

type Row = Record<string, any> & { _id: string };
function context() {
  const tables = new Map<string, Row[]>();
  const table = (name: string) => { if (!tables.has(name)) tables.set(name, []); return tables.get(name)!; };
  const db = {
    query(name: string) {
      let rows = [...table(name)];
      const query = {
        withIndex(_index: string, filter?: (f: any) => void) {
          const f = { eq(key: string, value: unknown) { rows = rows.filter(row => row[key] === value); return f; } };
          filter?.(f); return query;
        },
        order(direction: string) { rows.sort((a, b) => (direction === "desc" ? -1 : 1) * (a.createdAt - b.createdAt)); return query; },
        first: async () => rows[0] ?? null,
        unique: async () => { assert.ok(rows.length <= 1); return rows[0] ?? null; },
        collect: async () => rows, take: async (n: number) => rows.slice(0, n),
      };
      return query;
    },
    get: async (id: string) => [...tables.values()].flat().find(row => row._id === id) ?? null,
    insert: async (name: string, data: object) => { const _id = crypto.randomUUID(); table(name).push({ ...data, _id, _creationTime: Date.now() }); return _id; },
    patch: async (id: string, data: object) => { const row = await db.get(id); assert.ok(row); Object.assign(row, data); },
  };
  const ctx = { db, tables,
    runQuery: (ref: any, args: object) => run(getFunctionName(ref) === "prompts:getModerationSettings" ? prompts.getModerationSettings : prompts.checkSubmission, ctx, args),
    runMutation: (_ref: unknown, args: object) => run(prompts.acceptSubmission, ctx, args),
  };
  return ctx;
}
const run = (fn: any, ctx: any, args: object = {}) => fn._handler(ctx, args);
const identity = "25a8e21234567890";
const input = { identity, author: "Moss", text: "It starts raining hard." };

test("names are explicit, bounded choices; generated Viewer names are not valid", () => {
  for (const value of ["Viewer_25a8e2", "viewer_DEAD12", "Viewer", "Viewer_" + "a".repeat(16)]) {
    assert.equal(isGenericViewerName(value), true);
    assert.ok(viewerNameError(value));
  }
  for (const value of ["", "  ", "a".repeat(25), "a b", "a-b", "@Moss", "Moss\nInjected"]) assert.ok(viewerNameError(value));
  for (const value of ["Moss", "Moss_24", " Viewer_Sam ", "a".repeat(24)]) assert.equal(viewerNameError(value), null);
});

test("first name choice persists and retries neither rename nor extend the hourly cooldown", async t => {
  let now = 10_000;
  t.mock.method(Date, "now", () => now);
  const ctx = context();
  assert.deepEqual(await run(viewers.get, ctx, { identity }), { name: null, canChangeAt: 0 });
  assert.equal(await run(viewers.setName, ctx, { identity, name: " Moss " }), "Moss");
  now += 30_000;
  assert.equal(await run(viewers.setName, ctx, { identity, name: "Moss" }), "Moss");
  await assert.rejects(run(viewers.setName, ctx, { identity, name: "Fern" }), (error: any) => error.data.code === "NAME_CHANGE_COOLDOWN" && error.data.canChangeAt === 10_000 + VIEWER_NAME_COOLDOWN_MS);
  assert.equal(ctx.tables.get("viewers")?.length, 1);
  assert.deepEqual(await run(viewers.get, ctx, { identity }), { name: "Moss", canChangeAt: 10_000 + VIEWER_NAME_COOLDOWN_MS });
  await run(chat.send, ctx, { ...input, body: "Hello" });
  assert.equal(ctx.tables.get("messages")?.[0].author, "Moss");
  await assert.rejects(run(chat.send, ctx, { ...input, author: "Fern", body: "Forged name" }), new RegExp(VIEWER_NAME_MISMATCH));
  assert.equal((await run(prompts.acceptSubmission, ctx, input)).status, "accepted");
  assert.equal((await run(viewers.get, ctx, { identity })).canChangeAt, 10_000 + VIEWER_NAME_COOLDOWN_MS, "chat and prompts never restart the cooldown");
});

test("unnamed and generic legacy users cannot chat or reach moderation, even with a supplied custom author", async t => {
  let checks = 0;
  t.mock.method(globalThis, "fetch", async () => { checks++; throw new Error("Must not call provider"); });
  for (const legacy of [false, true]) {
    const ctx = context();
    if (legacy) await ctx.db.insert("messages", { identity, author: "Viewer_25a8e2", body: "Old message", createdAt: 1 });
    assert.deepEqual(await run(viewers.get, ctx, { identity }), { name: null, canChangeAt: 0 });
    await assert.rejects(run(chat.send, ctx, { ...input, body: "Hello" }), new RegExp(VIEWER_NAME_REQUIRED));
    assert.deepEqual(await run(prompts.submit, ctx, input), { status: "invalid", reason: VIEWER_NAME_REQUIRED });
    assert.deepEqual(await run(prompts.acceptSubmission, ctx, input), { status: "invalid", reason: VIEWER_NAME_REQUIRED });
    assert.equal(ctx.tables.get("prompts")?.length ?? 0, 0);
    assert.equal(ctx.tables.get("messages")?.length ?? 0, legacy ? 1 : 0);
    await run(viewers.setName, ctx, { identity, name: "Moss" });
    await run(chat.send, ctx, { ...input, body: "Now I can chat" });
    if (legacy) assert.equal(ctx.tables.get("messages")?.[0].author, "Viewer_25a8e2", "history keeps its original attribution");
  }
  assert.equal(checks, 0);
});

test("existing custom names are preserved and adopted without starting a cooldown", async () => {
  const ctx = context();
  await ctx.db.insert("messages", { identity, author: "Viewer_25a8e2", body: "First", createdAt: 1 });
  await ctx.db.insert("messages", { identity, author: "Moss", body: "Named", createdAt: 2 });
  assert.deepEqual(await run(viewers.get, ctx, { identity }), { name: "Moss", canChangeAt: 0 });
  await run(chat.send, ctx, { ...input, body: "Hello again" });
  assert.equal(ctx.tables.get("viewers")?.[0].name, "Moss", "first write durably adopts the legacy custom name");
  assert.equal((await run(viewers.get, ctx, { identity })).canChangeAt, 0);
  await run(viewers.setName, ctx, { identity, name: "Fern" });
  assert.equal(ctx.tables.get("messages")?.[1].author, "Moss", "old attribution does not change");
  assert.equal((await run(viewers.get, ctx, { identity })).name, "Fern");
});

test("a changed author or lost profile after moderation cannot pass atomic admission", async () => {
  const ctx = context();
  await run(viewers.setName, ctx, { identity, name: "Moss" });
  assert.equal(await run(prompts.checkSubmission, ctx, input), null);
  assert.deepEqual(await run(prompts.acceptSubmission, ctx, { ...input, author: "Fern" }), { status: "invalid", reason: VIEWER_NAME_MISMATCH });
  ctx.tables.set("viewers", []);
  assert.deepEqual(await run(prompts.acceptSubmission, ctx, input), { status: "invalid", reason: VIEWER_NAME_REQUIRED });
  assert.equal(ctx.tables.get("messages")?.length ?? 0, 0);
});

test("existing profile can rename immediately, then only at the exact one-hour boundary", async t => {
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  const ctx = context();
  await ctx.db.insert("viewers", { identity, name: "Moss", createdAt: now - 1 });
  await run(viewers.setName, ctx, { identity, name: "Fern" });
  const canChangeAt = now + VIEWER_NAME_COOLDOWN_MS;
  assert.deepEqual(await run(viewers.get, ctx, { identity }), { name: "Fern", canChangeAt });
  now = canChangeAt - 1;
  await assert.rejects(run(viewers.setName, ctx, { identity, name: "Stone" }), (error: any) => error.data.code === "NAME_CHANGE_COOLDOWN");
  now = canChangeAt;
  await run(viewers.setName, ctx, { identity, name: "Stone" });
  assert.deepEqual(await run(viewers.get, ctx, { identity }), { name: "Stone", canChangeAt: now + VIEWER_NAME_COOLDOWN_MS });
  assert.equal(ctx.tables.get("viewers")?.length, 1);
});

test("a rename cannot bypass the active prompt limit or alter old prompt attribution", async t => {
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  const ctx = context();
  await run(viewers.setName, ctx, { identity, name: "Moss" });
  const accepted = await run(prompts.acceptSubmission, ctx, input);
  now += VIEWER_NAME_COOLDOWN_MS;
  await run(viewers.setName, ctx, { identity, name: "Fern" });
  await run(chat.send, ctx, { identity, author: "Fern", body: "New name" });
  assert.equal((await ctx.db.get(accepted.promptId))?.author, "Moss");
  assert.equal(ctx.tables.get("messages")?.[0].author, "Moss");
  assert.equal(ctx.tables.get("messages")?.[1].author, "Fern");
  assert.match(await run(prompts.checkSubmission, ctx, { ...input, author: "Fern" }), /already have/);
  assert.equal(await run(prompts.checkSubmission, ctx, input), VIEWER_NAME_MISMATCH);
});

test("cooldown feedback uses the current interaction time and expires at the deadline", () => {
  assert.equal(nameChangeWait(3_600_000, 0), "You can change your name again in 60 min.");
  assert.equal(nameChangeWait(3_600_000, 3_540_001), "You can change your name again in 1 min.");
  assert.equal(nameChangeWait(3_600_000, 3_600_000), null);
  assert.equal(nameChangeWait(3_600_000, 3_600_001), null);
});

test("invalid name and identity claims do not create profiles", async () => {
  const ctx = context();
  for (const name of ["Viewer_25a8e2", "", "a".repeat(25), "Two Names"]) await assert.rejects(run(viewers.setName, ctx, { identity, name }));
  for (const value of ["", "bad identity", "a".repeat(65)]) await assert.rejects(run(viewers.setName, ctx, { identity: value, name: "Moss" }));
  assert.equal(ctx.tables.get("viewers")?.length ?? 0, 0);
});

test("workshop queue messages require names, while protected direct playback does not", async t => {
  const previous = process.env.BROADCASTER_SECRET;
  process.env.BROADCASTER_SECRET = "name-test-secret";
  t.after(() => { if (previous === undefined) delete process.env.BROADCASTER_SECRET; else process.env.BROADCASTER_SECRET = previous; });
  const ctx = context();
  const args = { ...input, secret: "name-test-secret", playNow: false };
  await assert.rejects(run(prompts.submitSegment, ctx, args), new RegExp(VIEWER_NAME_REQUIRED));
  const id = await run(prompts.submitSegment, ctx, { ...args, playNow: true, author: "Reactor" });
  assert.ok(id);
  assert.equal(ctx.tables.get("messages")?.length ?? 0, 0);
  await ctx.db.patch(id, { status: "played" });
  await run(viewers.setName, ctx, { identity, name: "Moss" });
  await run(prompts.submitSegment, ctx, args);
  assert.equal(ctx.tables.get("messages")?.[0].author, "Moss");
});

test("name setup is above chat, with name gating on both submission paths", () => {
  const source = readFileSync(new URL("../../../webapp/src/app/stream/broadcast-app.tsx", import.meta.url), "utf8");
  assert.ok(source.indexOf("<ViewerName") < source.indexOf("<form onSubmit={onChat}"));
  assert.match(source, /namesAvailable: nameServiceAvailable === true, viewerLoaded: viewer !== undefined, name/);
  assert.match(source, /const reason = promptBlockedReason/);
  assert.match(source, /!identity \|\| !name \? "Choose a name above the chat box/);
  assert.match(source, /if \(reason \|\| chatInFlight.current\)/);
  const form = readFileSync(new URL("../../../webapp/src/app/stream/viewer-name.tsx", import.meta.url), "utf8");
  assert.match(form, /You can change your name once an hour\./);
  assert.match(form, />change\?<\/button>/);
  assert.match(form, /aria-expanded=\{editing\}/);
  assert.match(form, /Replace your generic name to chat or prompt/);
});

test("an early rename uses the existing toast instead of a persistent cooldown row", () => {
  const form = readFileSync(new URL("../../../webapp/src/app/stream/viewer-name.tsx", import.meta.url), "utf8");
  assert.match(form, /nameChangeWait\(retryAt, Date\.now\(\)\)/);
  assert.match(form, /else if \(!showCooldown\(\)\)/);
  assert.match(form, /if \(name && showCooldown\(\)\) \{ closeEditor\(\); return; \}/);
  assert.match(form, /notifyCooldown\(nameChangeWait\(cause\.data\.canChangeAt, Date\.now\(\)\)/);
  assert.match(form, /<PromptNotice key=\{notice\.id\}.*dismissLabel="Dismiss name change notification"/);
  assert.doesNotMatch(form, /setInterval|viewer-name-wait|\{now \? wait/);
  const toast = readFileSync(new URL("../../../webapp/src/app/stream/private-prompt-message.tsx", import.meta.url), "utf8");
  assert.match(toast, /createPortal\(<div className="prompt-notice" role="alert"/);
  assert.match(toast, /setTimeout\(onDismiss, 12_000\)/);
});
