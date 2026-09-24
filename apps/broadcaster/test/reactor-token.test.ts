import assert from "node:assert/strict";
import test from "node:test";
import { createReactorTokenProvider, mintReactorToken } from "../src/reactor-token";
import type { BroadcasterConfig } from "../src/config";

const sessionId = "00000000-0000-4000-8000-000000000001";
const config = { REACTOR_LOCAL: false, REACTOR_MODEL: "reactor/fast-h3", REACTOR_API_URL: "https://api.example.test", REACTOR_API_KEY: "fixture-key" } as BroadcasterConfig;
const jwt = (exp: number, serial = 0) => `header.${Buffer.from(JSON.stringify({ exp, serial })).toString("base64url")}.signature`;

test("credentials refresh before expiry and remain pinned to the active session for days", async () => {
  let now = 1_000_000;
  const calls: (string | undefined)[] = [];
  const provider = createReactorTokenProvider(config, { now: () => now, mint: async id => {
    calls.push(id); return jwt(now / 1000 + 3600, calls.length);
  } });
  const initial = await provider.get();
  assert.equal(await provider.get(), initial);
  assert.deepEqual(calls, [undefined]);
  const bound = await provider.get(sessionId);
  assert.notEqual(bound, initial);
  assert.equal(await provider.get(), bound, "an absent id cannot unbind the established session");
  now += 3_539_000;
  assert.equal(await provider.get(sessionId), bound);
  now += 1_000;
  assert.notEqual(await provider.get(sessionId), bound);
  for (let hour = 0; hour < 48; hour++) { now += 3_600_000; await provider.get(sessionId); }
  assert.ok(calls.slice(1).every(id => id === sessionId), "renewal cannot authorize another session");
  await assert.rejects(provider.get("00000000-0000-4000-8000-000000000002"), /session changed/);
  await assert.rejects(provider.get("not-a-session"), /Invalid Reactor session/);
});

test("concurrent refreshes are single-flight and a rejected refresh can recover", async () => {
  let count = 0;
  let release!: (value: string) => void;
  const provider = createReactorTokenProvider(config, { now: () => 0, mint: () => {
    count++; return new Promise<string>(resolve => { release = resolve; });
  } });
  const first = provider.get(sessionId);
  const concurrent = provider.get(sessionId, true);
  assert.equal(count, 1);
  release(jwt(3600));
  assert.deepEqual(await Promise.all([first, concurrent]), [jwt(3600), jwt(3600)]);
  const renewed = provider.get(sessionId, true);
  assert.equal(count, 2);
  release(jwt(7200));
  assert.equal(await renewed, jwt(7200));

  let fail = true;
  const recovering = createReactorTokenProvider(config, { now: () => 0, mint: async () => {
    if (fail) throw new Error("Token service unavailable"); return jwt(3600);
  } });
  await assert.rejects(recovering.get(sessionId), /unavailable/);
  fail = false;
  assert.equal(await recovering.get(sessionId), jwt(3600));
});

test("malformed and expired credentials fail closed without exposing tokens", async () => {
  for (const value of ["private-secret", "header.bad-json.signature", jwt(0), jwt(4), jwt(NaN)]) {
    const provider = createReactorTokenProvider(config, { now: () => 0, mint: async () => value });
    await assert.rejects(provider.get(), error => error instanceof Error && !error.message.includes(value));
  }
  const local = createReactorTokenProvider({ ...config, REACTOR_LOCAL: true }, { mint: async () => { throw new Error("Must not mint in local runtime mode"); } });
  assert.equal(await local.get(), "");
});

test("token mint uses creation permission only at startup and binds renewal to the session", async t => {
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    calls.push(init); return new Response(JSON.stringify({ jwt: jwt(3600) }));
  });
  await mintReactorToken(config);
  await mintReactorToken(config, sessionId);
  const [start, renewal] = calls.map(call => JSON.parse(String(call.body)).authorization_details[0]);
  assert.deepEqual(start.constraints, { max_sessions: 1 });
  assert.equal(start.resources.sessions, undefined);
  assert.deepEqual(renewal.resources.sessions, { bind: [sessionId] });
  assert.deepEqual(renewal.resources.models, { match: [config.REACTOR_MODEL] });
  assert.equal(renewal.constraints, undefined);
  assert.ok(calls.every(call => call.signal instanceof AbortSignal));
});
