import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BROADCAST_WAITING_MESSAGE, publicBroadcastDetail } from "@reactor/infinite-contracts";
import { get } from "../../../webapp/convex/broadcast";

const run = (row: unknown) => (get as any)._handler({ db: { query: () => ({ withIndex: () => ({ unique: async () => row }) }) } }, {});

test("public status never returns provider, validation, retry or upcoming-scene diagnostics", async () => {
  for (const status of ["offline", "starting", "degraded", "live"]) {
    for (const detail of ["Cerebras error, 429", "Retrying scene planning (attempt 3) in 8s: Invalid Cerebras scene: visual exceeds 650 characters (666)", "Preparing the next secret scene", "An unknown future provider failure"]) {
      const row = { _id: "main", status, detail, currentAuthor: "Riley", currentChunkStartedAt: 123 };
      const result = await run(row);
      assert.equal(result.detail, status === "live" ? "Live transmission" : "Reactor TV will be right back");
      assert.ok(!JSON.stringify(result).includes(detail));
      assert.equal(result.currentChunkStartedAt, 123);
      assert.equal(row.detail, detail, "operator diagnostics remain stored unchanged");
    }
  }
  assert.equal((await run(null)).detail, BROADCAST_WAITING_MESSAGE);
  assert.equal(publicBroadcastDetail("future-status"), BROADCAST_WAITING_MESSAGE);
});

test("the viewer waiting lockup uses fixed copy, not a public or stale cached diagnostic", () => {
  const app = readFileSync("../../webapp/src/app/stream/broadcast-app.tsx", "utf8");
  assert.ok(app.includes("<strong>{BROADCAST_WAITING_MESSAGE}</strong>"));
  assert.ok(!app.includes("broadcast?.detail"));
  assert.ok(!app.includes("broadcast.detail"));
});
