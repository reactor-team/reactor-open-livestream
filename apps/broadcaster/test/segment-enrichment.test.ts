import assert from "node:assert/strict";
import test from "node:test";
import { enrichSegment } from "../../../webapp/src/lib/segment-enrichment";

function request(body: Record<string, unknown>, key = "test-key") {
  return new Request("http://localhost/admin/api/enrich", { method: "POST",
    headers: { "content-type": "application/json", "x-openai-api-key": key }, body: JSON.stringify(body) });
}
test("enrichment validates field, key and image requirements before calling OpenAI", async () => {
  assert.equal((await enrichSegment(request({ field: "title" }, ""))).status, 400);
  assert.equal((await enrichSegment(request({ field: "constructor" }))).status, 400);
  assert.equal((await enrichSegment(request({ field: "imageAnalysis" }))).status, 400);
});
test("enrichment sends optional direction and chunk budget, and returns only one replacement", async () => {
  const originalFetch = globalThis.fetch;
  let payload = "";
  globalThis.fetch = async (_url, options) => {
    payload = String(options?.body);
    return Response.json({ model: "test", output: [{ content: [{ type: "output_text", text: JSON.stringify({ value: "A clearer premise." }) }] }] });
  };
  try {
    const response = await enrichSegment(request({ field: "experience", experience: "An office", changeRequest: "More understated", chunkSeconds: 14 }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { value: "A clearer premise.", model: "test" });
    assert.ok(payload.includes("More understated"));
    assert.ok(payload.includes('chunkSeconds'));
    assert.ok(payload.includes("14"));
    assert.ok(payload.includes('"store":false'));
    assert.ok(!payload.includes("test-key"));
  } finally { globalThis.fetch = originalFetch; }
});
