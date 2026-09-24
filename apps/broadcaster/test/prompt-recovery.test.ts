import assert from "node:assert/strict";
import test from "node:test";
import { resetInFlight } from "../../../webapp/convex/prompts";

const secret = "prompt-recovery-unit-test";
process.env.BROADCASTER_SECRET = secret;
type Row = { _id: string; status: string; createdAt: number; queuedAt?: number; startedAt?: number; text: string; starAwarded?: boolean };

function context(rows: Row[]) {
  const reads: string[] = [];
  const patches: string[] = [];
  return { reads, patches, db: {
    query(table: string) {
      assert.equal(table, "prompts");
      return {
        collect() { assert.fail("Recovery must not scan prompt history"); },
        withIndex(index: string, filter: (q: { eq: (key: string, value: string) => void }) => void) {
          assert.equal(index, "by_status_created");
          let status = "";
          filter({ eq(key, value) { assert.equal(key, "status"); status = value; } });
          assert.ok(status === "queued" || status === "playing");
          reads.push(status);
          return { collect: async () => rows.filter(row => row.status === status) };
        },
      };
    },
    async patch(id: string, value: Partial<Row>) {
      const row = rows.find(row => row._id === id);
      assert.ok(row);
      patches.push(id);
      Object.assign(row, value);
    },
  } };
}
const run = (ctx: unknown, suppliedSecret = secret) =>
  (resetInFlight as unknown as { _handler: (ctx: unknown, args: { secret: string }) => Promise<void> })
    ._handler(ctx, { secret: suppliedSecret });

test("recovery reads only in-flight status ranges, preserving prompt history and attribution", async () => {
  const rows: Row[] = [
    { _id: "pending", status: "pending", createdAt: 1, text: "Waiting" },
    { _id: "queued", status: "queued", createdAt: 2, queuedAt: 20, text: "Queued", starAwarded: true },
    { _id: "playing", status: "playing", createdAt: 3, queuedAt: 21, startedAt: 30, text: "Playing", starAwarded: true },
    ...Array.from({ length: 20_000 }, (_, i) => ({ _id: `played-${i}`, status: "played", createdAt: i + 4, text: "History" })),
  ];
  const history = structuredClone(rows.slice(3));
  const ctx = context(rows);
  await run(ctx);
  assert.deepEqual(ctx.reads, ["queued", "playing"]);
  assert.deepEqual(ctx.patches, ["queued", "playing"]);
  assert.deepEqual(rows.slice(0, 3), [
    { _id: "pending", status: "pending", createdAt: 1, text: "Waiting" },
    { _id: "queued", status: "pending", createdAt: 2, queuedAt: undefined, startedAt: undefined, text: "Queued", starAwarded: true },
    { _id: "playing", status: "pending", createdAt: 3, queuedAt: undefined, startedAt: undefined, text: "Playing", starAwarded: true },
  ]);
  assert.deepEqual(rows.slice(3), history);
  await run(ctx);
  assert.equal(ctx.patches.length, 2, "repeated recovery is idempotent");
});

test("empty in-flight ranges need no writes and unauthorized recovery cannot query", async () => {
  const ctx = context([]);
  await assert.rejects(run(ctx, "wrong"), /Unauthorized/);
  assert.deepEqual(ctx.reads, []);
  await run(ctx);
  assert.deepEqual(ctx.patches, []);
});
