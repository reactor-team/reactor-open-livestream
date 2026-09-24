import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

for (const textOnly of [false, true]) test(`bridge buffers and replaces ${textOnly ? "text-only" : "image-backed"} segments`, async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const publications: Record<string, any>[] = [];
  const requests: Record<string, any>[] = [];
  const commands: string[] = [];
  const uploads: object[] = [];
  const errors: string[] = [];
  const states: { status: string; recovery?: string }[] = [];
  const retryDelays: number[] = [];
  const played: string[] = [];
  const voteEvents: string[] = [];
  const acceptedVotes: any[][] = [];
  const discardedVotes: string[] = [];
  let submitted = false;
  let retry: (() => void) | undefined;
  let plans = 0;
  let injectedFailure = false;
  let forceFailure = false;
  let safetyFailure = false;
  let now = 100;
  const plannerInputs: any[][] = [];
  let tokenSource: (() => Promise<string>) | undefined;
  let refreshed = false;
  let rejectedUpload = false;
  class Reactor {
    constructor(options: { jwt: () => Promise<string> }) { tokenSource = options.jwt; }
    getSessionId() { return "00000000-0000-4000-8000-000000000001"; }
    getPeerConnection() { return { connectionState: "connected", getStats: async () => new Map([["source", {
      id: "source", type: "inbound-rtp", kind: "video", framesDecoded: 100,
    }]]) }; }
    on(name: string, callback: (message: any) => void) { handlers.set(name, callback); }
    async connect() {}
    async requestSchema() { throw new Error("Continuous mode must not require ending-frame support"); }
    async resumeTrack() {}
    async uploadFile() {
      assert.equal(await tokenSource!(), refreshed ? "renewed" : "initial");
      if (!rejectedUpload) {
        rejectedUpload = true;
        const error = new Error('unexpected HTTP status 401 from create upload: {"error":"Invalid or expired token"}');
        handlers.get("error")!(error);
        throw error;
      }
      const ref = { file_id: `upload-${uploads.length}` };
      uploads.push(ref);
      return ref;
    }
    async sendCommand(name: string, payload: Record<string, any>) {
      commands.push(name);
      if (name === "enqueue") {
        requests.push(payload);
        return { data: { clip: { clip_id: `clip-${requests.length}` } } };
      }
      return {};
    }
  }
  const result = await build({
    entryPoints: ["src/bridge.ts"], bundle: true, write: false, format: "iife",
    plugins: [{ name: "mock-transports", setup(builder) {
      builder.onResolve({ filter: /^(@reactor-team\/js-sdk|livekit-client)$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
        contents: "export const { Reactor, Room, RoomEvent, Track } = globalThis.transports;",
      }));
    } }],
  });
  const bridgeContext = {
    transports: {
      Reactor, Room: class {
        state = "connected";
        async connect() {} on() {}
        localParticipant = {
          videoTrackPublications: new Map([["publication", { videoTrack: { getRTCStatsReport: async () => new Map([["outgoing", {
            id: "outgoing", type: "outbound-rtp", kind: "video", framesEncoded: 90,
          }]]) } }]]),
          publishTrack: async (_track: unknown, options: Record<string, any>) => { publications.push(options); },
        };
      },
      RoomEvent: { Disconnected: "disconnected" }, Track: { Source: { Camera: "camera", Microphone: "microphone" } },
    },
    crypto: { randomUUID: () => `trace-${requests.length}` },
    performance: { now: () => now },
    Date: { now: () => now },
    setTimeout: (callback: () => void, delay: number) => { retry = callback; retryDelays.push(delay); },
    fetch: async () => ({ ok: true, blob: async () => ({}) }),
    // No document, video, or canvas APIs: enqueue must not depend on playback capture.
    window: {
      runtimeConfig: async () => ({ clipSeconds: 10 }),
      reactorToken: async (id: string, force = false) => {
        assert.equal(id, "00000000-0000-4000-8000-000000000001");
        if (force) refreshed = true;
        return refreshed ? "renewed" : "initial";
      },
      getBroadcastSettings: async () => ({ chunkSeconds: 10, programDurationMinutes: 5 }),
      planScene: async (...args: any[]) => {
        if (!submitted) return null;
        if (safetyFailure) throw new Error("SCENE_SAFETY_BLOCKED");
        if (forceFailure) throw new Error("Planner unavailable");
        if (plans === 3) assert.ok(voteEvents.includes("finish:clip-1:original-run"), "planning waits for completed vote writes even when queue_update arrives first");
        if (textOnly && plans === 1 && !injectedFailure) { injectedFailure = true; throw new Error("Temporary planner failure"); }
        plannerInputs.push(args); return ({
        id: `prompt-${++plans}`, text: plans === 2 ? "They all set on fire" : "Test", viewerOverride: plans === 2, author: "Viewer", videoPrompt: "A flag stirs.", runId: plans <= 3 ? "original-run" : "replacement-run",
        sceneSummary: "", dialogue: "", plannerModel: "test", plannerLatencyMs: 0, plannedChunkSeconds: plans <= 3 ? 6 : 14,
        ...(plans === 1 ? { startsSegment: true, ...(textOnly ? {} : { openingFrameUrl: "/authored.png" }), continuityNotes: "Original office" } : {}),
        ...(plans === 4 ? { ...(textOnly ? {} : { openingFrameUrl: "/custom.png" }), startsSegment: true, continuous: true, continuityNotes: "Replacement office", playNow: true } : {}),
      }); },
      markPlaying: async () => {},
      voteAccepted: async (...args: any[]) => { acceptedVotes.push(args); },
      votePlayback: async (phase: string, clipId: string, runId: string) => {
        await new Promise<void>(resolve => setImmediate(resolve));
        voteEvents.push(`${phase}:${clipId}:${runId}`);
      },
      voteDiscard: async (clipId: string) => { discardedVotes.push(clipId); },
      debugPrompt: async () => {}, markPlayed: async (id: string) => { played.push(id); }, releasePrompt: async () => {},
      reportBridgeState: async (status: string, detail: string, recovery?: string) => { states.push({ status, recovery }); if (status === "degraded") errors.push(detail); },
    },
  };
  runInNewContext(result.outputFiles[0].text, bridgeContext);
  const mediaHealth = () => (bridgeContext.window as any).mediaHealth();
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setImmediate(resolve));
  };
  await settle();
  assert.equal(requests.length, 0, "empty startup never enqueues an invented scene");
  assert.equal(uploads.length, 0, "empty startup never uploads a default image");
  assert.equal(plans, 0);
  assert.ok(retry, "waiting broadcast checks for submitted scenes");
  submitted = true;
  retry();
  await settle();
  if (textOnly) {
    assert.equal(requests.length, 1, "planner failure does not enqueue unvalidated fallback text");
    assert.match(errors[0], /Retrying scene planning/);
    retry!();
    await settle();
  } else assert.deepEqual(errors, []);
  if (!textOnly) assert.equal(refreshed, true, "an expired upload is recovered without reporting a terminal bridge failure");
  await handlers.get("trackReceived")!("main_video", { readyState: "live", muted: false });
  const beforePlayback = await mediaHealth();
  assert.equal(beforePlayback.connected, true);
  assert.equal(beforePlayback.playing, false, "publishing a track alone is not live playback");
  assert.equal(beforePlayback.incoming[0].frames, 100);
  assert.equal(beforePlayback.outgoing[0].frames, 90);
  assert.equal(publications[0].simulcast, false, "publish only one native-resolution layer");
  assert.equal(publications[0].degradationPreference, "maintain-resolution", "do not shrink the stream under encoder pressure");
  assert.equal(publications[0].videoEncoding.maxFramerate, 24);
  assert.equal(requests.length, 3, "three continuous clips enqueue before playback");
  assert.equal(plans, 3, "every chunk receives a scene plan");
  assert.deepEqual(Array.from(plannerInputs[1][6]), [], "the current request is not accepted until enqueue succeeds");
  assert.deepEqual(Array.from(plannerInputs[2][6]), ["They all set on fire"], "accepted text changes survive automatic continuation");
  assert.equal(uploads.length, textOnly ? 0 : 1);
  assert.equal(requests[0].starting_frame, uploads[0]);
  assert.equal(requests[0].continue_from_clip_id, undefined);
  if (textOnly) assert.equal(plannerInputs[1][2], "Original office");
  assert.equal(requests[1].starting_frame, undefined);
  assert.equal(requests[1].continue_from_clip_id, "clip-1");
  assert.ok(commands.includes("set_autoplay"));
  assert.equal(acceptedVotes.length, 3, "each accepted clip registers its voting receipt before playback");
  assert.deepEqual(acceptedVotes[0].slice(0, 2), ["clip-1", "original-run"]);
  assert.equal(acceptedVotes[0][4], 2, "vote duration defaults to two chunks");
  assert.equal(plannerInputs[1][5].runId, "original-run", "continuations keep the same ballot run");
  handlers.get("message")!({ type: "clip_started", data: { clip: { clip_id: "clip-1", metadata: requests[0].metadata } } });
  assert.equal((await mediaHealth()).playing, true);
  now += 15_001;
  assert.equal((await mediaHealth()).playing, false, "stuck clip state cannot report healthy after accepted playback duration");
  handlers.get("message")!({ type: "queue_update", data: { generation: [2, 3].map(n => ({ clip_id: `clip-${n}`, metadata: requests[n - 1].metadata })), playout: [] } });

  handlers.get("message")!({ type: "clip_finished", data: { clip: { clip_id: "clip-1", metadata: requests[0].metadata } } });
  await settle();
  assert.equal(requests.length, 6, "priority replacement rebuilds its continuous buffer");
  assert.deepEqual(voteEvents, ["start:clip-1:original-run", "finish:clip-1:original-run"], "playback voting writes remain ordered");
  assert.deepEqual(discardedVotes, ["clip-3", "clip-2"], "replacement cancels unused future ballots");
  assert.deepEqual(requests.map(request => request.seconds), [6, 6, 6, 14, 14, 14], "enqueue uses the duration selected before planning");
  assert.equal(JSON.parse(requests[0].metadata).segment.chunkSeconds, 6);
  assert.equal(JSON.parse(requests[3].metadata).segment.chunkSeconds, 14);
  assert.equal(plannerInputs[1][5].elapsedSeconds, 6, "schedule counts the chosen chunk duration");
  assert.deepEqual(played, ["prompt-1"], "each finished chunk retires its prompt immediately");
  assert.equal(uploads.length, textOnly ? 0 : 2);
  assert.equal(requests[3].starting_frame, uploads[1]);
  assert.equal(requests[3].continue_from_clip_id, undefined);
  assert.equal(requests[4].starting_frame, undefined);
  assert.equal(requests[4].continue_from_clip_id, "clip-4");
  assert.equal(plannerInputs[4][0].length, 1, "replacement does not inherit old scene history");
  assert.equal(plannerInputs[4][2], "Replacement office");
  assert.equal(JSON.parse(requests[3].metadata).startsSegment, true);
  handlers.get("message")!({ type: "clip_started", data: { clip: { clip_id: "clip-4", metadata: requests[3].metadata } } });
  now += 600_000;
  handlers.get("message")!({ type: "clip_finished", data: { clip: { clip_id: "clip-2" } } });
  await settle();
  assert.equal(requests.length, 6, "stale completion cannot expand the buffer");
  handlers.get("message")!({ type: "clip_finished", data: { clip: { clip_id: "clip-4" } } });
  await settle();
  assert.equal(requests.length, 7);
  assert.ok(voteEvents.includes("start:clip-4:replacement-run"));
  assert.ok(voteEvents.includes("finish:clip-4:replacement-run"));
  assert.ok(!voteEvents.some(event => event.startsWith("finish:clip-2:")), "discarded clips cannot advance a vote");
  assert.equal(requests[6].continue_from_clip_id, "clip-6");
  assert.equal(uploads.length, textOnly ? 0 : 2, "continuations never re-upload a frame");
  assert.equal(JSON.parse(requests[6].metadata).startsSegment, false, "continuous segment does not reset after the default program duration");
  assert.equal(JSON.parse(requests[6].metadata).continuous, undefined);
  assert.equal(plans, requests.length);
  for (const request of requests) {
    assert.equal(request.ending_frame, undefined);
    assert.equal(JSON.parse(request.metadata).phase, undefined);
  }
  forceFailure = true;
  assert.deepEqual(Array.from(plannerInputs[4][6]), [], "a replacement segment clears accepted viewer changes");
  const requestsBeforeFailure = requests.length;
  handlers.get("message")!({ type: "clip_finished", data: { clip: { clip_id: "clip-5", metadata: requests[4].metadata } } });
  await settle();
  for (let i = 0; i < 7; i++) { retry!(); await settle(); }
  assert.deepEqual(retryDelays.slice(-8), [2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
  assert.equal(requests.length, requestsBeforeFailure, "failed plans never enqueue fallback text");
  assert.ok(states.filter(state => state.status === "degraded").every(state => state.recovery === "retrying"), "planner failures never ask the supervisor to exit");
  assert.match(errors.at(-1)!, /Retrying scene planning.*in 30s/);
  forceFailure = false;
  retry!(); await settle();
  assert.equal(requests.length, requestsBeforeFailure + 1, "planning recovers in the same bridge after more than three failures");
  assert.equal(requests.at(-1)!.continue_from_clip_id, "clip-7", "retry preserves the accepted native chain");
  assert.notEqual(states.at(-1)!.status, "degraded", "only a validated, accepted retry clears degraded state");
  forceFailure = true;
  handlers.get("message")!({ type: "clip_finished", data: { clip: { clip_id: "clip-6", metadata: requests[5].metadata } } });
  await settle();
  assert.equal(retryDelays.at(-1), 2000, "success resets the retry delay");
  if (textOnly) {
    forceFailure = false;
    safetyFailure = true;
    const timerCount = retryDelays.length;
    retry!(); await settle();
    assert.equal(states.at(-1)!.recovery, "restart", "unsafe scenes clear the contaminated session instead of retrying it");
    assert.equal(retryDelays.length, timerCount, "a safety rejection does not schedule a planning retry");
    assert.equal(requests.length, requestsBeforeFailure + 1, "unsafe scenes never enqueue");
  }
  handlers.get("message")!({ type: "clip_failed", data: { clip: { clip_id: "clip-7" } } });
  await settle();
  assert.equal(states.at(-1)!.recovery, undefined, "terminal media errors use the supervisor restart policy");
  forceFailure = false;
  retry!(); await settle();
  assert.equal(requests.length, requestsBeforeFailure + 1, "pending planner retries cannot continue a terminally failed media chain");
  handlers.get("message")!({ type: "clip_started", data: { clip: { clip_id: "clip-7", metadata: requests[6].metadata } } });
  handlers.get("message")!({ type: "clip_stopped", data: { clip: { clip_id: "clip-7" } } });
  await settle();
  assert.ok(played.includes("prompt-7"), "a stopped on-air prompt releases its viewer even without a finish event");
});
