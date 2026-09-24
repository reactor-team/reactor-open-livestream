import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AccessToken } from "livekit-server-sdk";
import { chromium, type Browser } from "playwright";
import { publicBroadcastDetail, SCENE_SAFETY_FAILURE, type BroadcastStatus, type TableSnapshot, type ScheduleCursor, type SegmentRun } from "@reactor/infinite-contracts";

import { missingBridgeConfig, readConfig } from "./config";
import { BroadcastStore } from "./convex";
import { createFailureWatchdog } from "./failure-watchdog";
import type { BridgeRecovery } from "./recovery-policy";
import { createIdleLease } from "./idle-lease";
import { createReactorTokenProvider } from "./reactor-token";
import { CerebrasStoryPlanner, type StoryHistoryItem } from "./story-planner";
import { PromptDebugLog } from "./prompt-debug";
import { PromptTimingTracker } from "./prompt-timing";
import { planWithRetry } from "./planning-retry";
import { resolveSceneDirection } from "./scene-direction";
import { nextScheduledScene, resolveChunkSeconds } from "./schedule";
import { randomUUID } from "node:crypto";
import { createMediaProgressProbe } from "./media-health";
import type { VoteOption } from "@reactor/infinite-contracts";

const config = readConfig();
const store = new BroadcastStore(config);
const promptDebug = new PromptDebugLog();
let browser: Browser | null = null;
let status: BroadcastStatus = config.BROADCASTER_MANUAL ? "offline" : "starting";
let detail = config.BROADCASTER_MANUAL ? "Stream stopped" : "Starting bridge";
let currentPrompt: string | undefined;
let currentAuthor: string | undefined;
let currentChunkStartedAt: number | undefined;
let currentSegmentStartedAt: number | undefined;
let continuous = false;
let currentSegment: SegmentRun | undefined;
let currentTable: TableSnapshot | undefined;
let startedAt: number | undefined;
const failureWatchdog = createFailureWatchdog({
  manual: config.BROADCASTER_MANUAL,
  onExpire: () => {
    console.error("[broadcaster] Terminal bridge failure did not recover; exiting for supervised restart:", detail);
    process.exit(1);
  },
});
let streamDesired = !config.BROADCASTER_MANUAL;
let controlQueue = Promise.resolve();
let promptTiming: PromptTimingTracker | undefined;
let timingTimer: ReturnType<typeof setTimeout> | undefined;

async function publishQueueTiming(): Promise<void> {
  if (!promptTiming || !startedAt || !streamDesired || !browser) return;
  await store.updateQueueTiming(startedAt, promptTiming.snapshot());
}

function scheduleQueueTiming(): void {
  if (timingTimer) return;
  timingTimer = setTimeout(() => {
    timingTimer = undefined;
    void publishQueueTiming().catch(() => console.warn("[timing] Queue estimate temporarily unavailable"));
  }, 200);
}

const directory = dirname(fileURLToPath(import.meta.url));
const developmentIdleTimeoutMs = 5 * 60 * 1000;
const idleLease = createIdleLease({
  timeoutMs: developmentIdleTimeoutMs,
  onExpire: () => queueControl(async () => {
    if (streamDesired) await stopStream("Stopped after five minutes without page activity");
  }),
  onError: (error) => console.error("[idle-timeout]", error),
});

function html(): string {
  return "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><script type=\"module\" src=\"/bridge.js\"></script></body></html>";
}

const server = createServer(async (request, response) => {
  if (request.url === "/control/media" && request.method === "GET") {
    if (!config.BROADCASTER_MANUAL) { response.writeHead(404).end(); return; }
    try {
      const page = browser?.contexts()[0]?.pages()[0];
      const media = page ? await page.evaluate(() => window.mediaStats?.()) : null;
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ status, media }));
    } catch {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Media diagnostics unavailable" }));
    }
    return;
  }
  if (request.url === "/control/prompts" && request.method === "GET") {
    if (!config.BROADCASTER_MANUAL) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ status, mode: "Continuous", entries: promptDebug.snapshot() }));
    return;
  }
  if (request.url === "/health") {
    response.writeHead(status === "degraded" ? 503 : 200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: status !== "degraded", status,
      detail: config.BROADCASTER_MANUAL ? detail : publicBroadcastDetail(status), active: streamDesired }));
    return;
  }
  if (request.url === "/control" && request.method === "GET") {
    if (!config.BROADCASTER_MANUAL) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ active: streamDesired, status, detail, room: config.LIVEKIT_ROOM }));
    return;
  }
  if (
    (request.url === "/control/start" ||
      request.url === "/control/stop" ||
      request.url === "/control/keepalive") &&
    request.method === "POST"
  ) {
    if (!config.BROADCASTER_MANUAL) {
      response.writeHead(404).end();
      return;
    }
    try {
      if (request.url === "/control/keepalive") {
        renewIdleLease();
      } else {
        await queueControl(request.url === "/control/start" ? startStream : stopStream);
      }
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ active: streamDesired, status, detail, room: config.LIVEKIT_ROOM }));
    } catch (error) {
      response.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({
        active: streamDesired,
        status,
        detail: error instanceof Error ? error.message : String(error),
        room: config.LIVEKIT_ROOM,
      }));
    }
    return;
  }
  if (request.url === "/bridge.js") {
    try {
      const script = await readFile(join(directory, "bridge.js"));
      response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
      response.end(script);
    } catch {
      response.writeHead(404).end();
    }
    return;
  }
  if (request.url === "/reactor_wasm_bg.wasm") {
    try {
      const module = await readFile(join(directory, "reactor_wasm_bg.wasm"));
      response.writeHead(200, {
        "content-type": "application/wasm",
        "cache-control": "public, max-age=31536000, immutable",
      });
      response.end(module);
    } catch {
      response.writeHead(404).end();
    }
    return;
  }
  response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
  response.end(html());
});


async function publishHeartbeat(): Promise<void> {
  await store.heartbeat({
    status,
    detail,
    currentPrompt,
    currentAuthor,
    currentChunkStartedAt,
    currentSegmentStartedAt,
    continuous,
    segment: currentSegment,
    table: currentTable,
    startedAt,
  });
  scheduleQueueTiming();
}

function queueControl(operation: () => Promise<void>): Promise<void> {
  const next = controlQueue.then(operation, operation);
  controlQueue = next.catch(() => undefined);
  return next;
}

function renewIdleLease(): void {
  if (!config.BROADCASTER_MANUAL || !streamDesired) return;
  idleLease.renew();
}

async function runBridge(): Promise<void> {
  const storyPlanner = new CerebrasStoryPlanner({
    apiKey: config.CEREBRAS_API_KEY!,
    model: config.CEREBRAS_MODEL,
    reasoningEffort: config.CEREBRAS_REASONING_EFFORT,
    timeoutMs: config.CEREBRAS_TIMEOUT_MS,
    clipSeconds: config.CLIP_SECONDS,
  });
  const livekitToken = new AccessToken(config.LIVEKIT_API_KEY!, config.LIVEKIT_API_SECRET!, {
    identity: "streamer",
    name: "streamer",
    ttl: "24h",
  });
  livekitToken.addGrant({
    room: config.LIVEKIT_ROOM,
    roomJoin: true,
    canPublish: true,
    canPublishData: false,
    canSubscribe: false,
  });

  const reactorTokens = createReactorTokenProvider(config);
  await reactorTokens.get();
  const launchedBrowser = await chromium.launch({
    headless: true,
    channel: config.BROADCASTER_MANUAL ? "chrome" : undefined,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  browser = launchedBrowser;
  const page = await launchedBrowser.newPage();
  await page.exposeFunction("reactorToken", async (sessionId?: string, force = false) => {
    if (browser !== launchedBrowser || !streamDesired) throw new Error("Stream stopped");
    const jwt = await reactorTokens.get(sessionId, force);
    if (browser !== launchedBrowser || !streamDesired) throw new Error("Stream stopped");
    return jwt;
  });
  promptDebug.clear();
  const timing = new PromptTimingTracker();
  promptTiming = timing;
  await page.exposeFunction("debugPrompt", (event: string, id: string, value: unknown) => {
    if (browser !== launchedBrowser || !streamDesired) return;
    timing.observe(event, id, value);
    scheduleQueueTiming();
    if (!config.BROADCASTER_MANUAL) return;
    const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
    if (event === "sent") promptDebug.sent(id, data);
    else if (event === "accepted") promptDebug.accepted(id, typeof data.clip_id === "string" ? data.clip_id : null);
    else if (event === "state" && typeof data.type === "string") promptDebug.event(id, data.type);
  });
  await page.exposeFunction("runtimeConfig", async () => ({
    livekitUrl: config.LIVEKIT_URL,
    livekitToken: await livekitToken.toJwt(),
    videoBitrate: config.LIVEKIT_VIDEO_BITRATE_K * 1000,
    reactorModel: config.REACTOR_MODEL,
    reactorLocal: config.REACTOR_LOCAL,
    reactorLocalUrl: config.REACTOR_LOCAL_URL,
    clipSeconds: config.CLIP_SECONDS,
  }));
  await page.exposeFunction("getBroadcastSettings", async () => {
    if (browser !== launchedBrowser || !streamDesired) throw new Error("Stream stopped");
    return await store.getSettings();
  });
  await page.exposeFunction("planScene", async (
    history: StoryHistoryItem[],
    clipSeconds: number,
    activeContinuityNotes?: string,
    activeVoicePrompt?: string,
    activeInteractionRunId?: string,
    cursor?: ScheduleCursor,
    acceptedViewerRequests: string[] = [],
  ) => {
    if (browser !== launchedBrowser || !streamDesired) throw new Error("Stream stopped");
    const settings = await store.getSettings();
    const scheduled = nextScheduledScene(await store.getSchedule(), cursor);
    const submitted = await store.claimPrompt(Boolean(scheduled) || settings.interactionMode === "voting");
    if (!submitted && !scheduled && cursor && cursor.elapsedSeconds >= cursor.durationSeconds) return null;
    const direction = submitted ? resolveSceneDirection(submitted, history.length > 0)
      : scheduled ?? resolveSceneDirection(null, history.length > 0);
    if (!direction) return null;
    const newSegment = Boolean(direction.startsSegment || direction.playNow || direction.openingFrameUrl);
    const runId = newSegment ? randomUUID() : cursor?.runId ?? randomUUID();
    const votePlan = settings.interactionMode === "voting" ? await store.voting("planning", { runId }) as { prepare: boolean; winner: { id: string; label: string; direction: string } | null } : null;
    if (votePlan?.winner && !newSegment) {
      direction.text = votePlan.winner.direction; direction.author = "REACTOR TV";
      direction.voteWinnerRoundId = votePlan.winner.id;
    }
    direction.runId = runId;
    direction.prepareVote = votePlan?.prepare;
    direction.voteDurationChunks = settings.voteDurationChunks;
    try {
      const effectiveChunkSeconds = resolveChunkSeconds(clipSeconds, newSegment, direction.segment?.chunkSeconds ?? direction.chunkSeconds, cursor);
      timing.beginPlanning(direction.id, effectiveChunkSeconds);
      scheduleQueueTiming();
      const runId = newSegment ? direction.interactionRunId : activeInteractionRunId;
      const table = runId ? await store.tableSnapshot(runId) : undefined;
      const plan = await planWithRetry(() => storyPlanner.plan(
        { ...direction, table },
        newSegment ? [] : history,
        effectiveChunkSeconds,
        activeContinuityNotes,
        activeVoicePrompt,
        newSegment ? [] : acceptedViewerRequests,
      ));
      const safety = await store.checkScene(plan.videoPrompt, direction.text, direction.id);
      if (safety === "rejected") throw new Error(SCENE_SAFETY_FAILURE);
      if (safety !== "allowed") throw new Error("Scene safety check unavailable; nothing enqueued.");
      timing.planned();
      console.log(`[story] ${plan.plannerModel} planned ${plan.plannerLatencyMs}ms`);
      return { ...plan, plannedChunkSeconds: effectiveChunkSeconds };
    } catch (error) {
      timing.planningFailed();
      scheduleQueueTiming();
      console.error("[planner]", error instanceof Error ? error.message : String(error));
      if (direction.id) await store.releasePrompt(direction.id).catch(() => undefined);
      if (direction.voteWinnerRoundId) await store.voting("release", { roundId: direction.voteWinnerRoundId }).catch(() => undefined);
      throw error;
    }
  });
  await page.exposeFunction("voteAccepted", async (clipId: string, runId: string, segmentTitle: string, options: VoteOption[] | undefined, durationChunks: number, winnerRoundId?: string) => {
    if (browser !== launchedBrowser || !streamDesired) return;
    await store.voting("accepted", { clipId, runId, segmentTitle, options, durationChunks, winnerRoundId });
  });
  await page.exposeFunction("votePlayback", async (phase: "start" | "finish", clipId: string, runId: string) => {
    if (browser !== launchedBrowser || !streamDesired) return;
    await store.voting("playback", { phase, clipId, runId });
  });
  await page.exposeFunction("voteDiscard", async (clipId: string) => {
    if (browser !== launchedBrowser || !streamDesired) return;
    await store.voting("discard", { clipId });
  });
  await page.exposeFunction("markPlaying", async (
    id: string | null,
    text: string,
    author: string,
    startsSegment: boolean,
    table?: TableSnapshot,
    isContinuous = false,
    segment?: SegmentRun,
  ) => {
    if (browser !== launchedBrowser || !streamDesired) return;
    currentPrompt = text;
    if (status !== "degraded") {
      status = "live";
      detail = "Live transmission";
    }
    currentAuthor = author;
    currentTable = table;
    continuous = isContinuous;
    currentSegment = segment;
    currentChunkStartedAt = Date.now();
    if (startsSegment || !currentSegmentStartedAt) currentSegmentStartedAt = currentChunkStartedAt;
    await store.markPlaying(id);
    await publishHeartbeat();
  });
  await page.exposeFunction("markPlayed", async (id: string | null) => {
    if (browser !== launchedBrowser || !streamDesired) return;
    if (id) await store.markPlayed(id);
  });
  await page.exposeFunction("releasePrompt", async (id: string | null) => {
    if (browser !== launchedBrowser || !streamDesired || !id) return;
    await store.releasePrompt(id);
  });
  await page.exposeFunction(
    "reportBridgeState",
    async (nextStatus: "starting" | "live" | "degraded", nextDetail?: string, recovery: BridgeRecovery = "restart") => {
      if (browser !== launchedBrowser || !streamDesired) return;
      if (nextStatus === "degraded") console.error("[bridge-state]", nextDetail);
      status = nextStatus;
      detail = nextDetail ?? (nextStatus === "live" ? "Publishing to LiveKit" : detail);
      // Decide synchronously so a delayed heartbeat cannot arm a stale exit timer.
      failureWatchdog.update(nextStatus, recovery);
      await publishHeartbeat();
    },
  );
  page.on("console", (message) => console.log(`[bridge] ${message.text()}`));
  page.on("pageerror", (error) => console.error("[bridge]", error));
  if (!config.BROADCASTER_MANUAL) {
    const progress = createMediaProgressProbe();
    const sessionStartedAt = startedAt!;
    let sampling = false;
    const timer = setInterval(async () => {
      if (sampling || browser !== launchedBrowser || !streamDesired) return;
      sampling = true;
      // Timestamp before sampling so a delayed browser/RPC reply cannot renew health.
      const observedAt = Date.now();
      try {
        const sample = await page.evaluate(() => window.mediaHealth?.());
        const healthy = sample ? progress(sample) : false;
        if (browser === launchedBrowser && streamDesired) {
          await store.reportMediaHealth(sessionStartedAt, observedAt, healthy);
        }
      } catch {
        // Missing samples expire independently in Convex, even if this process dies.
        console.warn("[stream-monitor] Could not report media health");
      } finally {
        sampling = false;
      }
    }, 2000);
    page.once("close", () => clearInterval(timer));
  }
  await page.goto(`http://127.0.0.1:${config.PORT}`, { waitUntil: "domcontentloaded" });
}

async function startStream(): Promise<void> {
  if (streamDesired && browser) return;
  const missing = missingBridgeConfig(config);
  if (missing.length) {
    streamDesired = false;
    status = "degraded";
    detail = `Missing local stream configuration: ${missing.join(", ")}`;
    await publishHeartbeat();
    throw new Error(detail);
  }

  streamDesired = true;
  renewIdleLease();
  status = "starting";
  detail = "Connecting to Reactor";
  currentPrompt = undefined;
  currentAuthor = undefined;
  currentChunkStartedAt = undefined;
  currentSegmentStartedAt = undefined;
  continuous = false;
  currentSegment = undefined;
  currentTable = undefined;
  startedAt = Date.now();
  promptTiming = undefined;
  try {
    await store.resetInFlight();
    await publishHeartbeat();
    await runBridge();
    renewIdleLease();
  } catch (error) {
    const failedBrowser = browser;
    browser = null;
    streamDesired = false;
    idleLease.clear();
    status = "degraded";
    detail = error instanceof Error ? error.message : String(error);
    failureWatchdog.update("degraded", "restart");
    await failedBrowser?.close().catch(() => undefined);
    await publishHeartbeat();
    throw error;
  }
}

async function stopStream(reason = "Stream stopped"): Promise<void> {
  streamDesired = false;
  promptTiming = undefined;
  idleLease.clear();
  const activeBrowser = browser;
  browser = null;
  failureWatchdog.clear();
  await activeBrowser?.close().catch(() => undefined);
  await store.resetInFlight();
  status = "offline";
  detail = reason;
  currentPrompt = undefined;
  currentAuthor = undefined;
  currentChunkStartedAt = undefined;
  currentSegmentStartedAt = undefined;
  continuous = false;
  currentSegment = undefined;
  startedAt = undefined;
  currentTable = undefined;
  await publishHeartbeat();
}

async function main(): Promise<void> {
  const host = config.BROADCASTER_MANUAL ? "127.0.0.1" : "0.0.0.0";
  await new Promise<void>((resolve) => server.listen(config.PORT, host, resolve));
  console.log(`[broadcaster] health server on :${config.PORT}`);
  await publishHeartbeat();
  setInterval(() => void publishHeartbeat().catch((error) => console.error("[heartbeat]", error)), 15_000);
  if (!config.BROADCASTER_MANUAL) await startStream();
}

async function shutdown(): Promise<void> {
  streamDesired = false;
  status = "degraded";
  detail = "Broadcaster stopping";
  failureWatchdog.clear();
  idleLease.clear();
  await publishHeartbeat().catch(() => undefined);
  const activeBrowser = browser;
  browser = null;
  await activeBrowser?.close().catch(() => undefined);
  await store.close();
  server.close();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown().finally(() => process.exit(0)));
}

void main().catch(async (error: unknown) => {
  status = "degraded";
  detail = error instanceof Error ? error.message : String(error);
  console.error("[broadcaster]", error);
  failureWatchdog.update("degraded", "restart");
  await publishHeartbeat().catch(() => undefined);
  process.exitCode = 1;
});
