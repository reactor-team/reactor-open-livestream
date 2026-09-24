import assert from "node:assert/strict";
import test from "node:test";
import { isUploadAuthenticationError, withUploadAuthRetry } from "../src/upload-auth";

const rejected = () => new Error('unexpected HTTP status 401 from create upload: {"error":"Invalid or expired token"}');

test("a rejected opening upload refreshes credentials and retries the same operation once", async () => {
  let uploads = 0, refreshes = 0;
  const ref = { file_id: "opening" };
  const result = await withUploadAuthRetry(async () => { if (++uploads === 1) throw rejected(); return ref; }, async () => { refreshes++; });
  assert.equal(result, ref); assert.equal(uploads, 2); assert.equal(refreshes, 1);
});

test("persistent authentication failure is bounded and unrelated failures are never replayed", async () => {
  let uploads = 0, refreshes = 0;
  await assert.rejects(withUploadAuthRetry(async () => { uploads++; throw rejected(); }, async () => { refreshes++; }), /401/);
  assert.equal(uploads, 2); assert.equal(refreshes, 1);
  for (const message of ["HTTP status 500 from create upload", "HTTP status 403 from create upload", "HTTP status 401 from enqueue", "connection reset"]) {
    let attempts = 0;
    await assert.rejects(withUploadAuthRetry(async () => { attempts++; throw new Error(message); }, async () => { assert.fail("Unrelated failure must not renew credentials"); }));
    assert.equal(attempts, 1);
    assert.equal(isUploadAuthenticationError(new Error(message)), false);
  }
});

test("failed renewal does not retry with rejected credentials", async () => {
  let attempts = 0;
  await assert.rejects(withUploadAuthRetry(async () => { attempts++; throw rejected(); }, async () => { throw new Error("Renewal unavailable"); }), /Renewal unavailable/);
  assert.equal(attempts, 1);
});
