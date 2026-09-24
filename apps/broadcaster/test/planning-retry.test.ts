import assert from "node:assert/strict";
import test from "node:test";
import { planWithRetry } from "../src/planning-retry";

test("an isolated planning timeout retries the same work", async () => {
  let calls = 0;
  assert.equal(await planWithRetry(async () => {
    if (++calls === 1) throw new DOMException("Timed out", "TimeoutError");
    return "planned scene";
  }), "planned scene");
  assert.equal(calls, 2);
});
test("repeated timeouts name the failing service, other failures are not retried", async () => {
  let calls = 0;
  await assert.rejects(planWithRetry(async () => {
    calls++;
    throw new DOMException("Timed out", "TimeoutError");
  }), /Cerebras scene planning timed out after two attempts/);
  assert.equal(calls, 2);
  await assert.rejects(planWithRetry(async () => { throw new Error("Invalid plan"); }), /Invalid plan/);
});
