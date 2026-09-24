import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const supervisorBundle = build({ entryPoints: ["src/server.ts"], bundle: true, write: false, format: "cjs", platform: "node", packages: "external",
  define: { "import.meta.url": JSON.stringify("file:///fixture/server.js") },
  plugins: [{ name: "supervisor-transports", setup(builder) {
    builder.onResolve({ filter: new RegExp("^(?:node:http|livekit-server-sdk|playwright|[.]/(?:config|convex|story-planner|reactor-token))$") }, args => ({ path: args.path, namespace: "mock" }));
    builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export const { createServer, AccessToken, chromium, missingBridgeConfig, readConfig, BroadcastStore, CerebrasStoryPlanner, createReactorTokenProvider } = globalThis.mocks;" }));
  } }],
});

test("production supervisor keeps retry heartbeats alive and cannot arm a stale exit after recovery", async () => {
  const exposed = new Map<string, (...args: any[]) => Promise<void>>();
  const timers = new Set<{ run: () => void; delay: number; unref: () => void }>();
  const exits: number[] = [];
  const watchdogTimers = () => [...timers].filter(timer => timer.delay === 10_000);
  const heartbeats: { status: string }[] = [];
  const mediaPulses: any[][] = [];
  const intervals: { run: () => Promise<void>; delay: number }[] = [];
  let mediaFrames = 0;
  const plans: any[][] = [];
  let safety: "allowed" | "rejected" | "unavailable" = "allowed";
  const safetyChecks: unknown[][] = [];
  let requestHandler: any;
  let claimed: any = { _id: "viewer", text: "They all set on fire", author: "Harvey" };
  let holdHeartbeat = false;
  let releaseHeartbeat: (() => void) | undefined;
  const page = { exposeFunction: async (name: string, fn: (...args: any[]) => Promise<void>) => { exposed.set(name, fn); }, on() {}, once() {}, goto: async () => {},
    evaluate: async () => ({ connected: true, playing: true, incoming: [{ id: "source", frames: mediaFrames }], outgoing: [{ id: "published", frames: mediaFrames }] }),
  };
  const browser = { newPage: async () => page, close: async () => {} };
  const bundled = await supervisorBundle;
  const module = { exports: {} };
  runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url),
    console: { log() {}, error() {}, warn() {} },
    process: { once() {}, exit: (code: number) => exits.push(code) },
    setTimeout: (run: () => void, delay: number) => { const timer = { run, delay, unref() {} }; timers.add(timer); return timer; },
    clearTimeout: (timer: any) => timers.delete(timer), clearInterval() {},
    setInterval(run: () => Promise<void>, delay: number) { const timer = { run, delay }; intervals.push(timer); return timer; },
    mocks: {
      createServer: (handler: any) => { requestHandler = handler; return { listen: (_port: number, _host: string, done: () => void) => done(), close() {} }; },
      AccessToken: class { addGrant() {} toJwt() { return "fixture"; } },
      chromium: { launch: async () => browser },
      missingBridgeConfig: () => [],
      readConfig: () => ({ BROADCASTER_MANUAL: false, PORT: 8080, CLIP_SECONDS: 10 }),
      BroadcastStore: class {
        async reportMediaHealth(...args: any[]) { mediaPulses.push(args); }
        async checkScene(...args: unknown[]) { safetyChecks.push(args); return safety; }
        async releasePrompt() {}
        async resetInFlight() {} async markPlaying() {} async updateQueueTiming() {}
        async getSettings() { return { interactionMode: "prompts", chunkSeconds: 6 }; }
        async getSchedule() { return []; }
        async claimPrompt() { return claimed; }
        async heartbeat(value: { status: string }) {
          heartbeats.push(value);
          if (holdHeartbeat) { holdHeartbeat = false; await new Promise<void>(resolve => { releaseHeartbeat = resolve; }); }
        }
      },
      CerebrasStoryPlanner: class { async plan(...args: any[]) { plans.push(args); return { ...args[0], plannerModel: "fixture", plannerLatencyMs: 1 }; } }, createReactorTokenProvider: () => ({ get: async () => "fixture" }),
    },
  });
  for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setImmediate(resolve));
  const sampleMedia = intervals.find(timer => timer.delay === 2000)!.run;
  mediaFrames = 20; await sampleMedia();
  mediaFrames = 40; await sampleMedia();
  await sampleMedia();
  assert.deepEqual(mediaPulses.map(p => p[2]), [false, true, false]);
  assert.ok(mediaPulses.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])));
  const planScene = exposed.get("planScene")!;
  const history = [{ videoPrompt: "An ordinary office.", sceneSummary: "", dialogue: "" }];
  await planScene(history, 6, "No chaos", "", undefined, undefined, ["Rain starts"]);
  assert.equal(plans[0][0].viewerOverride, true, "claimed text receives override authority");
  assert.deepEqual(Array.from(plans[0][5]), ["Rain starts"], "supervisor forwards accepted changes");
  claimed = { ...claimed, startsSegment: true };
  await planScene(history, 6, "No chaos", "", undefined, undefined, ["Rain starts"]);
  assert.equal(plans[1][0].viewerOverride, false, "workshop segments retain their own constitution");
  assert.deepEqual(Array.from(plans[1][5]), [], "supervisor clears changes on a new segment");
  assert.equal(safetyChecks.length, 2, "every plan passes the final safety gate");
  safety = "rejected";
  await assert.rejects(planScene(history, 6, "No chaos", ""), /SCENE_SAFETY_BLOCKED/);
  safety = "unavailable";
  await assert.rejects(planScene(history, 6, "No chaos", ""), /safety check unavailable/);
  safety = "allowed";
  const report = exposed.get("reportBridgeState")!;
  assert.ok(report);
  await report("degraded", "Cerebras 429: Retrying scene planning", "retrying");
  let healthStatus = 0;
  let healthBody = "";
  await requestHandler({ url: "/health", method: "GET" }, {
    writeHead: (code: number) => { healthStatus = code; }, end: (body: string) => { healthBody = body; },
  });
  assert.equal(healthStatus, 503, "health still reports failure to Railway");
  assert.equal(JSON.parse(healthBody).detail, "Reactor TV will be right back");
  assert.doesNotMatch(healthBody, /Cerebras|429|Retrying/);
  assert.equal(watchdogTimers().length, 0, "recoverable degradation must not schedule process.exit");
  for (const timer of timers) if (timer.delay === 200) timer.run();
  assert.deepEqual(exits, [], "telemetry timers never exit the process");
  assert.equal(heartbeats.at(-1)!.status, "degraded");
  await exposed.get("markPlaying")!(null, "Buffered clip", "Viewer");
  assert.equal(heartbeats.at(-1)!.status, "degraded", "buffered playback cannot hide planner failures");
  holdHeartbeat = true;
  const late = report("degraded", "Connection lost");
  assert.equal(watchdogTimers().length, 1);
  await report("live", "Recovered");
  releaseHeartbeat!(); await late;
  assert.equal(watchdogTimers().length, 0, "a late heartbeat cannot rearm an exit after recovery");
  assert.deepEqual(exits, []);
  await report("degraded", "Media chain failed");
  assert.equal(watchdogTimers().length, 1);
  const timer = watchdogTimers()[0]; assert.equal(timer.delay, 10_000);
  timer.run(); assert.deepEqual(exits, [1], "terminal errors still request a Railway restart");
});

for (const failure of ["heartbeat", "reset", "launch", "page"] as const) {
  test(`production startup exits after ${failure} failure even when error reporting stalls`, async () => {
    const timers = new Set<{ run: () => void; delay: number; unref: () => void }>();
    const exits: number[] = [];
    let requestHandler: any;
    let resetCalls = 0;
    let closes = 0;
    const page = { exposeFunction: async () => {}, on() {}, once() {}, goto: async () => { if (failure === "page") throw new Error("Fixture page failed"); } };
    const bundled = await supervisorBundle;
    const module = { exports: {} };
    runInNewContext(bundled.outputFiles[0].text, {
      module, exports: module.exports, require: createRequire(import.meta.url),
      console: { log() {}, error() {} },
      process: { once() {}, exit: (code: number) => exits.push(code) },
      setTimeout: (run: () => void, delay: number) => { const timer = { run, delay, unref() {} }; timers.add(timer); return timer; },
      clearTimeout: (timer: any) => timers.delete(timer), setInterval() {},
      mocks: {
        createServer: (handler: any) => { requestHandler = handler; return { listen: (_port: number, _host: string, done: () => void) => done(), close() {} }; },
        AccessToken: class { addGrant() {} toJwt() { return "fixture"; } },
        chromium: { launch: async () => {
          if (failure === "launch") throw new Error("Fixture launch failed");
          return { newPage: async () => page, close: async () => { closes++; } };
        } },
        missingBridgeConfig: () => [],
        readConfig: () => ({ BROADCASTER_MANUAL: false, PORT: 8080, CLIP_SECONDS: 10 }),
        BroadcastStore: class {
          async resetInFlight() { resetCalls++; if (failure === "reset") throw new Error("Fixture reconciliation failed"); }
          async heartbeat(value: { status: string }) {
            if (value.status === "degraded") await new Promise(() => {});
            if (failure === "heartbeat") throw new Error("Fixture heartbeat failed");
          }
        },
        CerebrasStoryPlanner: class {}, createReactorTokenProvider: () => ({ get: async () => "fixture" }),
      },
    });
    for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(resetCalls, failure === "heartbeat" ? 0 : 1);
    assert.equal(closes, failure === "page" ? 1 : 0);
    const watchdogs = [...timers].filter(timer => timer.delay === 10_000);
    assert.equal(watchdogs.length, 1, "startup arms one watchdog before stalled error telemetry");
    let healthStatus = 0;
    let healthBody = "";
    await requestHandler({ url: "/health", method: "GET" }, {
      writeHead: (code: number) => { healthStatus = code; }, end: (body: string) => { healthBody = body; },
    });
    assert.equal(healthStatus, 503);
    assert.equal(JSON.parse(healthBody).detail, "Reactor TV will be right back");
    assert.doesNotMatch(healthBody, /Fixture/);
    if (failure !== "heartbeat") assert.equal(JSON.parse(healthBody).active, false);
    watchdogs[0].run();
    assert.deepEqual(exits, [1]);
  });
}
