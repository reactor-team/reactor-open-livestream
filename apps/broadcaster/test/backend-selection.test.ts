import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { resolve } from "node:path";
import { BACKEND_COOKIE, publicBackend, resolveBackend } from "../../../webapp/src/lib/backend-config";

const env = { NODE_ENV: "development", NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3210", BROADCASTER_SECRET: "local-secret", DEV_REMOTE_CONVEX_URL: "https://staging.convex.cloud", DEV_REMOTE_SITE_URL: "https://staging.test", DEV_REMOTE_BROADCASTER_SECRET: "remote-secret" };
test("backend selection keeps database and credentials paired and production ignores remote selection", () => {
  const local = resolveBackend(undefined, env), remote = resolveBackend("staging", env);
  assert.equal(local.target, "local"); assert.equal(local.secret, "local-secret");
  assert.equal(remote.convexUrl, "https://staging.convex.cloud"); assert.equal(remote.secret, "remote-secret");
  assert.equal(remote.remoteSiteUrl, "https://staging.test");
  assert.deepEqual(publicBackend(remote), { target: "staging", convexUrl: "https://staging.convex.cloud", switchable: true, stagingAvailable: true });
  assert.doesNotMatch(JSON.stringify(publicBackend(remote)), /secret|remoteSiteUrl/);
  const production = resolveBackend("staging", { ...env, NODE_ENV: "production" });
  assert.equal(production.target, "deployment"); assert.equal(production.secret, "local-secret"); assert.equal(production.stagingAvailable, false);
});
test("staging configuration fails closed instead of falling back or accepting unsafe origins", () => {
  for (const value of [undefined, "http://localhost", "https://user:password@staging.test", "https://staging.test/path", "https://staging.test?override=yes"]) {
    assert.throws(() => resolveBackend("staging", { ...env, DEV_REMOTE_SITE_URL: value }));
  }
  assert.throws(() => resolveBackend("staging", { ...env, DEV_REMOTE_CONVEX_URL: undefined }));
  assert.equal(resolveBackend("staging", { ...env, DEV_REMOTE_BROADCASTER_SECRET: undefined }).secret, undefined);
});

async function moduleFor(path: string, mocks: Record<string, unknown>, environment: Record<string, string | undefined> = env, define?: Record<string, string>) {
  const bundled = await build({ define, entryPoints: [resolve("../../webapp/src", path)], bundle: true, write: false, platform: "node", format: "cjs", alias: { "@": resolve("../../webapp/src") }, plugins: [{ name: "backend-mocks", setup(builder) {
    builder.onResolve({ filter: /^(?:server-only|next\/headers|@\/lib\/backend|@\/lib\/admin-auth|convex\/browser|convex\/server|livekit-server-sdk)$/ }, args => ({ path: args.path, namespace: "mock" }));
    builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export const { cookies, headers, getBackend, isLocalBackend, isAdminAuthenticated, ConvexHttpClient, anyApi, AccessToken } = globalThis.mocks;" }));
  } }] });
  const module = { exports: {} as Record<string, (request: Request) => Promise<Response>> };
  runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, mocks, process: { env: environment }, Request, Response, URL, AbortSignal, console: { error: () => undefined }, fetch: mocks.fetch });
  return module.exports;
}
const post = (path: string, body: object, origin = "http://localhost:3000") => new Request("http://localhost:3000"+path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
test("debug selection is same-origin, enum-only, HTTP-only and unavailable in production", async () => {
  const writes: unknown[][] = [];
  const mocks = { cookies: async () => ({ set: (...args: unknown[]) => writes.push(args) }) };
  const route = await moduleFor("app/api/dev/backend/route.ts", mocks);
  assert.equal((await route.POST(post("/api/dev/backend", { target: "staging" }, "https://foreign.test"))).status, 403);
  assert.equal((await route.POST(post("/api/dev/backend", { target: "https://foreign.test" }))).status, 400);
  assert.equal(writes.length, 0);
  const response = await route.POST(post("/api/dev/backend", { target: "staging" }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(writes[0][0], BACKEND_COOKIE); assert.equal((writes[0][2] as { httpOnly: boolean }).httpOnly, true);
  assert.doesNotMatch(await response.text(), /secret|https:/);
  const production = await moduleFor("app/api/dev/backend/route.ts", mocks, { ...env, NODE_ENV: "production" });
  assert.equal((await production.POST(post("/api/dev/backend", { target: "staging" }))).status, 404);
  assert.equal(writes.length, 1);
});
test("remote LiveKit tokens come from staging without forwarding secrets or falling back to local minting", async () => {
  let fail = false, calls = 0;
  const route = await moduleFor("app/api/livekit/token/route.ts", {
    getBackend: async () => resolveBackend("staging", env),
    AccessToken: class { constructor() { assert.fail("Must not mint a local token for staging"); } },
    fetch: async (url: URL, init: RequestInit) => {
      calls++; assert.equal(url.origin, "https://staging.test"); assert.equal(url.pathname, "/api/livekit/token"); assert.equal(url.searchParams.get("identity"), "aabbccddeeff");
      assert.equal(init.headers, undefined); assert.equal(init.redirect, "error");
      if (fail) throw Error("Remote offline");
      return Response.json({ url: "wss://staging.livekit.cloud", token: "subscriber-fixture", unexpected: "not-forwarded" });
    },
  });
  const request = new Request("http://localhost:3000/api/livekit/token?identity=aabbccddeeff") as Request & { nextUrl: URL };
  request.nextUrl = new URL(request.url);
  assert.deepEqual(await (await route.GET(request)).json(), { url: "wss://staging.livekit.cloud", token: "subscriber-fixture" });
  fail = true; assert.equal((await route.GET(request)).status, 503); assert.equal(calls, 2);
});
test("staging disables all local stream controls and prompt polling without touching the supervisor", async () => {
  const mocks = { isLocalBackend: async () => false, fetch: () => assert.fail("Must not contact local supervisor") };
  const controls = await moduleFor("app/api/dev/stream/route.ts", mocks);
  assert.equal((await controls.GET(new Request("http://localhost:3000/api/dev/stream"))).status, 404);
  for (const action of ["start", "stop", "keepalive"]) assert.equal((await controls.POST(post("/api/dev/stream", { action }))).status, 404);
  const inspector = await moduleFor("app/api/dev/stream/prompts/route.ts", mocks);
  assert.equal((await inspector.GET(new Request("http://localhost:3000/api/dev/stream/prompts"))).status, 404);
});
test("staging library access requires Admin authentication and uses only the remote server credential", async () => {
  let authenticated = false; const calls: string[] = [];
  const route = await moduleFor("app/admin/api/programming/route.ts", {
    isAdminAuthenticated: async () => authenticated, isLocalBackend: async () => false, getBackend: async () => resolveBackend("staging", env),
    anyApi: { segments: { list: "segments:list" }, schedule: { list: "schedule:list" } },
    ConvexHttpClient: class {
      constructor(url: string) { assert.equal(url, "https://staging.convex.cloud"); }
      async query(ref: string, args: { secret: string }) { assert.equal(args.secret, "remote-secret"); calls.push(ref); return []; }
    },
  });
  assert.equal((await route.GET(new Request("http://localhost:3000/admin/api/programming"))).status, 401);
  assert.equal(calls.length, 0); authenticated = true;
  const result = await route.GET(new Request("http://localhost:3000/admin/api/programming"));
  assert.equal(result.status, 200); assert.equal(calls.length, 2); assert.doesNotMatch(await result.text(), /secret/);
});

test("server resolver rejects stale form targets after a cookie switch", async () => {
  let expected = "local";
  const mocks = { cookies: async () => ({ get: () => ({ value: "staging" }) }), headers: async () => new Headers({ "x-reactor-backend": expected }) };
  const resolver = await moduleFor("lib/backend.ts", mocks);
  const request = new Request("http://localhost:3000/admin");
  await assert.rejects(resolver.getBackend(request), /Backend changed/);
  expected = "staging";
  const backend = await resolver.getBackend(request) as unknown as { target: string; secret: string };
  assert.equal(backend.target, "staging"); assert.equal(backend.secret, "remote-secret");
});

test("production requires a configured Convex URL instead of silently connecting to localhost", () => {
  assert.throws(() => resolveBackend(undefined, { NODE_ENV: "production" }), /Convex is not configured/);
  assert.equal(resolveBackend(undefined, { NODE_ENV: "development" }).convexUrl, "http://127.0.0.1:3210");
});

test("production resolver retains the build-time public URL when runtime contains no public environment value", async () => {
  const runtime = { NODE_ENV: "production", BROADCASTER_SECRET: "deployment-secret" };
  const define = { "process.env.NEXT_PUBLIC_CONVEX_URL": JSON.stringify("https://build.convex.cloud") };
  const resolver = await moduleFor("lib/backend.ts", {}, runtime, define);
  const request = new Request("https://staging.test/");
  const backend = await resolver.getBackend(request) as unknown as { target: string; convexUrl: string; secret: string };
  assert.equal(backend.target, "deployment");
  assert.equal(backend.convexUrl, "https://build.convex.cloud");
  assert.equal(backend.secret, "deployment-secret");
  const override = await moduleFor("lib/backend.ts", {}, { ...runtime, CONVEX_URL: "https://runtime.convex.cloud" }, define);
  assert.equal((await override.getBackend(request) as unknown as { convexUrl: string }).convexUrl, "https://runtime.convex.cloud");
});
