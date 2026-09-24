import assert from "node:assert/strict";
import test from "node:test";
import * as segments from "../../../webapp/convex/segments";
import * as schedule from "../../../webapp/convex/schedule";
import * as seed from "../../../webapp/convex/seed";
import { officeSeed } from "../../../webapp/convex/lib/officeSeed";

type Row = Record<string, unknown> & { _id: string };
const secret = "programming-unit-test";
process.env.BROADCASTER_SECRET = secret;

function context() {
  const tables = new Map<string, Row[]>();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const files = new Map([["frame", { size: 20, contentType: "image/png" }]]);
  const db = {
    system: { get: async (id: string) => files.get(id) },
    query(name: string) {
      let rows = [...table(name)];
      const query = {
        withIndex(index: string, filter?: (q: { eq: (key: string, value: unknown) => void }) => void) {
          filter?.({ eq: (key, value) => { rows = rows.filter(row => row[key] === value); } });
          if (index === "by_position") rows.sort((a, b) => Number(a.position) - Number(b.position));
          return query;
        },
        collect: async () => rows,
        order: (direction: string) => { if (direction === "desc") rows.reverse(); return query; },
        first: async () => rows[0] ?? null,
        unique: async () => { assert.ok(rows.length <= 1); return rows[0] ?? null; },
      };
      return query;
    },
    get: async (id: string) => [...tables.values()].flat().find(row => row._id === id) ?? null,
    insert: async (name: string, value: Record<string, unknown>) => {
      const _id = name + ":" + crypto.randomUUID(); table(name).push({ ...value, _id }); return _id;
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      const row = await db.get(id); assert.ok(row); Object.assign(row, value);
    },
    delete: async (id: string) => {
      for (const rows of tables.values()) { const i = rows.findIndex(row => row._id === id); if (i >= 0) rows.splice(i, 1); }
    },
  };
  return { db, storage: { getUrl: async (id: string) => "https://storage.example/" + id } };
}
async function run(fn: unknown, ctx: unknown, args: Record<string, unknown> = {}): Promise<unknown> {
  return (fn as { _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown> })._handler(ctx, { secret, ...args });
}
const draft = { clientKey: "fixture", title: "Fixture", direction: "A scene.", continuity: "Stay in the office.",
  voicePrompt: "", experience: "", imageAnalysis: "", generationModel: "" };

test("library frames persist independently; editing a segment updates referenced slots", async () => {
  const ctx = context();
  const openingFrame = { storageId: "frame", name: "frame.png", bytes: 20, width: 2, height: 2 };
  const id = await run(segments.save, ctx, { ...draft, openingFrame });
  await run(schedule.edit, ctx, { operation: "add", segmentId: id });
  await run(schedule.edit, ctx, { operation: "add", segmentId: id, durationSeconds: 60 });
  await run(segments.save, ctx, { ...draft, id, title: "Edited fixture" });
  const entries = await run(schedule.list, ctx) as Row[];
  assert.equal(entries.length, 2);
  assert.ok(entries.every(row => row.title === "Edited fixture" && row.openingFrameUrl === "https://storage.example/frame"));
  assert.deepEqual(entries.map(row => row.durationSeconds), [300, 60]);
  await run(schedule.edit, ctx, { operation: "remove", id: entries[0]._id });
  const library = await run(segments.list, ctx) as Row[];
  assert.equal(library.length, 1);
  assert.equal((library[0].openingFrame as Record<string, unknown>).storageId, "frame");
});

test("migration is idempotent and does not resurrect removed legacy slots", async () => {
  const ctx = context();
  await ctx.db.insert("scheduledSegments", { title: "Office", text: "An office scene.", continuityNotes: "", voicePrompt: "", durationSeconds: 300, position: 1, enabled: true, updatedAt: 123 });
  assert.deepEqual(await run(schedule.migrateLegacy, ctx), { imported: 1 });
  assert.deepEqual(await run(schedule.migrateLegacy, ctx), { imported: 0 });
  const entries = await run(schedule.list, ctx) as Row[];
  await run(schedule.edit, ctx, { operation: "remove", id: entries[0]._id });
  assert.deepEqual(await run(schedule.migrateLegacy, ctx), { imported: 0 });
  assert.equal((await run(segments.list, ctx) as Row[]).length, 1);
});

test("drafts can be incomplete but cannot air; secrets and limits are enforced", async () => {
  const ctx = context();
  const id = await run(segments.save, ctx, { ...draft, direction: "" });
  await assert.rejects(run(schedule.edit, ctx, { operation: "add", segmentId: id }), /starting prompt/);
  await assert.rejects(run(segments.list, ctx, { secret: "wrong" }), /Unauthorized/);
  await assert.rejects(run(segments.save, ctx, { ...draft, direction: "x".repeat(801) }), /exceeds/);
  await assert.rejects(run(schedule.edit, ctx, { operation: "add", segmentId: id, durationSeconds: 1 }), /Duration/);
  await assert.rejects(run(segments.save, ctx, { ...draft, openingFrame: { storageId: "missing", name: "missing.png", bytes: 2, width: 1, height: 1 } }), /Invalid opening frame/);
});
test("segment chunk override can be saved, preserved, cleared and validated", async () => {
  const ctx = context();
  const id = await run(segments.save, ctx, { ...draft, chunkSeconds: 14 });
  await run(schedule.edit, ctx, { operation: "add", segmentId: id });
  assert.equal((await run(schedule.list, ctx) as Row[])[0].chunkSeconds, 14);
  await run(segments.save, ctx, { ...draft, id });
  assert.equal((await run(segments.list, ctx) as Row[])[0].chunkSeconds, 14);
  await run(segments.save, ctx, { ...draft, id, chunkSeconds: null });
  assert.equal((await run(schedule.list, ctx) as Row[])[0].chunkSeconds, undefined);
  await assert.rejects(run(segments.save, ctx, { ...draft, chunkSeconds: 15 }), /Chunk length/);
  await assert.rejects(run(segments.save, ctx, { ...draft, chunkSeconds: 7.5 }), /Chunk length/);
});


test("office seed preserves edits and removed schedules, and removal touches only its own data", async () => {
  const ctx = context();
  const otherId = await run(segments.save, ctx, { ...draft, clientKey: "other-scene" });
  await run(schedule.edit, ctx, { operation: "add", segmentId: otherId });
  const first = await run(seed.office, ctx) as { created: boolean; segmentId: string };
  assert.equal(first.created, true);
  let entries = await run(schedule.list, ctx) as Row[];
  assert.equal(entries.length, 2);
  assert.equal(entries[1].durationSeconds, 300);
  assert.equal(entries[1].enabled, true);
  assert.equal(entries[1].title, officeSeed.title);
  await ctx.db.patch(first.segmentId, { title: "My edited office" });
  await run(schedule.edit, ctx, { operation: "update", id: entries[1]._id, enabled: false });
  assert.deepEqual(await run(seed.office, ctx), { created: false, segmentId: first.segmentId });
  entries = await run(schedule.list, ctx) as Row[];
  assert.equal(entries.length, 2);
  assert.equal(entries[1].enabled, false);
  assert.equal(entries[1].title, "My edited office");
  await run(schedule.edit, ctx, { operation: "remove", id: entries[1]._id });
  await run(seed.office, ctx);
  assert.equal((await run(schedule.list, ctx) as Row[]).length, 1);
  await run(schedule.edit, ctx, { operation: "add", segmentId: first.segmentId });
  assert.deepEqual(await run(seed.removeOffice, ctx), { removed: true });
  assert.deepEqual(await run(seed.removeOffice, ctx), { removed: false });
  const remaining = await run(segments.list, ctx) as Row[];
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, otherId);
  assert.equal((await run(schedule.list, ctx) as Row[]).length, 1);
});

test("office source satisfies the same field limits as an admin-authored scene", async () => {
  const ctx = context();
  await run(segments.save, ctx, { ...officeSeed, clientKey: "validate-office" });
});
