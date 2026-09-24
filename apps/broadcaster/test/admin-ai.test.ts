import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { enrich } from "../../../webapp/convex/adminAi";

type Result = { status: number; data: { value?: string; model?: string; error?: string } };
const run = (args: Record<string, unknown>) => (enrich as unknown as { _handler: (ctx: object, args: object) => Promise<Result> })._handler({}, args);
const revision = () => Response.json({ model: "test-model", output: [{ content: [{ type: "output_text", text: JSON.stringify({ value: "An understated office scene." }) }] }] });

test("Convex Admin AI requires server authorization and a deployment key before any provider call", async () => {
  const oldSecret = process.env.BROADCASTER_SECRET;
  const oldKey = process.env.OPENAI_API_KEY;
  const oldFetch = globalThis.fetch;
  process.env.BROADCASTER_SECRET = "admin-action-secret";
  delete process.env.OPENAI_API_KEY;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return revision(); };
  try {
    await assert.rejects(run({ secret: "browser-cannot-authorize", input: { field: "title" } }), /Unauthorized/);
    const missing = await run({ secret: "admin-action-secret", input: { field: "title" }, apiKey: "browser-key-is-ignored" });
    assert.equal(missing.status, 503);
    assert.match(missing.data.error!, /Set OPENAI_API_KEY.*Convex/);
    assert.equal(calls, 0);
  } finally {
    if (oldSecret === undefined) delete process.env.BROADCASTER_SECRET; else process.env.BROADCASTER_SECRET = oldSecret;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    globalThis.fetch = oldFetch;
  }
});

test("Convex Admin AI uses only its deployment key, preserves contextual enrichment and does not leak provider errors", async () => {
  const oldSecret = process.env.BROADCASTER_SECRET;
  const oldKey = process.env.OPENAI_API_KEY;
  const oldFetch = globalThis.fetch;
  process.env.BROADCASTER_SECRET = "admin-action-secret";
  process.env.OPENAI_API_KEY = "server-only-fixture-key";
  const calls: RequestInit[] = [];
  const args = { secret: "admin-action-secret", input: { field: "startingPrompt", title: "Synthetic office", changeRequest: "Keep it quiet", chunkSeconds: 14 } };
  globalThis.fetch = async (url, init) => { assert.equal(url, "https://api.openai.com/v1/responses"); calls.push(init!); return revision(); };
  try {
    const result = await run({ ...args, apiKey: "browser-key-is-ignored" });
    assert.deepEqual(result, { status: 200, data: { value: "An understated office scene.", model: "test-model" } });
    assert.equal(calls.length, 1);
    assert.equal(new Headers(calls[0].headers).get("authorization"), "Bearer server-only-fixture-key");
    assert.match(String(calls[0].body), /Keep it quiet/);
    assert.ok(!String(calls[0].body).includes("server-only-fixture-key"));
    assert.ok(!JSON.stringify(result).includes("server-only-fixture-key"));
    globalThis.fetch = async () => Response.json({ error: { message: "Invalid API key: server-only-fixture-key" } }, { status: 401 });
    const failed = await run(args);
    assert.equal(failed.status, 401);
    assert.match(failed.data.error!, /authorization failed/);
    assert.ok(!JSON.stringify(failed).includes("server-only-fixture-key"));
    globalThis.fetch = async () => { throw new DOMException("Provider timeout", "TimeoutError"); };
    assert.match((await run(args)).data.error!, /too long/);
  } finally {
    if (oldSecret === undefined) delete process.env.BROADCASTER_SECRET; else process.env.BROADCASTER_SECRET = oldSecret;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    globalThis.fetch = oldFetch;
  }
});

test("Admin enrichment route checks session and origin, forwards only allowlisted fields, and keeps secrets server-side", async () => {
  let authorized = false;
  const calls: Array<{ ref: string; args: Record<string, unknown> }> = [];
  let fail = false;
  const bundled = await build({ entryPoints: ["../../webapp/src/app/admin/api/enrich/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", plugins: [{ name: "mock-admin", setup(builder) {
    builder.onResolve({ filter: /^(?:@\/lib\/(?:admin-auth|backend)|convex\/browser|convex\/server)$/ }, args => ({ path: args.path, namespace: "mock" }));
    builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export const { isAdminAuthenticated, getBackend, ConvexHttpClient, anyApi } = globalThis.mocks;" }));
  } }] });
  const module = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, Request, Response, URL,
    process: { env: { CONVEX_URL: "https://synthetic.convex.cloud", BROADCASTER_SECRET: "route-only-secret" } },
    mocks: { getBackend: async () => ({ convexUrl: "https://synthetic.convex.cloud", secret: "route-only-secret" }), isAdminAuthenticated: async () => authorized, anyApi: { adminAi: { enrich: "adminAi:enrich" } },
      ConvexHttpClient: class {
        constructor(url: string) { assert.equal(url, "https://synthetic.convex.cloud"); }
        async action(ref: string, args: Record<string, unknown>) {
          calls.push({ ref, args });
          if (fail) throw new Error("Private transport failure with route-only-secret");
          return { status: 200, data: { value: "Revised", model: "test" } };
        }
      },
    },
  });
  const request = (body: object, origin = "http://localhost") => new Request("http://localhost/admin/api/enrich", { method: "POST", headers: { "content-type": "application/json", origin, "x-openai-api-key": "browser-secret" }, body: JSON.stringify(body) });
  assert.equal((await module.exports.POST(request({ field: "title" }))).status, 401);
  authorized = true;
  assert.equal((await module.exports.POST(request({ field: "title" }, "https://wrong-origin.test"))).status, 403);
  assert.equal((await module.exports.POST(request({ field: "constructor" }))).status, 400);
  assert.equal((await module.exports.POST(request({ field: "title", chunkSeconds: 99 }))).status, 400);
  assert.equal(calls.length, 0);
  const response = await module.exports.POST(request({ field: "title", title: "Synthetic office", secret: "untrusted", apiKey: "browser-secret" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { value: "Revised", model: "test" });
  assert.equal(calls[0].args.secret, "route-only-secret");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args.input)), { field: "title", title: "Synthetic office" });
  assert.ok(!JSON.stringify(calls).includes("browser-secret"));
  fail = true;
  const failed = await module.exports.POST(request({ field: "title" }));
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes("route-only-secret"));
});
