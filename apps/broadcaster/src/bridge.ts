import { Reactor, type ReactorMessage } from "@reactor-team/js-sdk";
import { SCENE_SAFETY_FAILURE, type BroadcastSettings, type TableSnapshot, type ScheduleCursor, type SegmentRun } from "@reactor/infinite-contracts";
import { Room, RoomEvent, Track } from "livekit-client";

import { plannerRetryDelay, type BridgeRecovery } from "./recovery-policy";
import { clipFromMessageData, enqueuePayload } from "./continuity";
import type { PlannedScene, StoryHistoryItem } from "./story-planner";
import type { VoteOption } from "@reactor/infinite-contracts";
import { isUploadAuthenticationError, withUploadAuthRetry } from "./upload-auth";
import type { MediaHealthSample } from "./media-health";

type BridgeConfig = {
  livekitUrl: string;
  livekitToken: string;
  videoBitrate: number;
  reactorModel: string;
  reactorLocal: boolean;
  reactorLocalUrl: string;
  clipSeconds: number;
};

type Prompt = {
  runId?: string;
  id: string | null;
  text: string;
  author: string;
  continuityNotes?: string;
  voicePrompt?: string;
  openingFrameUrl?: string | null;
  playNow?: boolean;
  startsSegment?: boolean;
  continuous?: boolean;
  segment?: SegmentRun;
  table?: TableSnapshot;
};
type ClipPayload = { clip?: { metadata?: string } };
type QueuedClip = Prompt & { clipId: string };
type CapturableAudioElement = HTMLAudioElement & { captureStream: () => MediaStream };

declare global {
  interface Window {
    voteAccepted?: (clipId: string, runId: string, segmentTitle: string, options: VoteOption[] | undefined, durationChunks: number, winnerRoundId?: string) => Promise<void>;
    votePlayback?: (phase: "start" | "finish", clipId: string, runId: string) => Promise<void>;
    voteDiscard?: (clipId: string) => Promise<void>;
    mediaStats: () => Promise<unknown>;
    mediaHealth: () => Promise<MediaHealthSample>;
    debugPrompt: (event: string, id: string, value: unknown) => Promise<void>;
    runtimeConfig: () => Promise<BridgeConfig>;
    reactorToken: (sessionId?: string, force?: boolean) => Promise<string>;
    getBroadcastSettings: () => Promise<BroadcastSettings>;
    planScene: (
      history: StoryHistoryItem[],
      clipSeconds: number,
      activeContinuityNotes?: string,
      activeVoicePrompt?: string,
      activeInteractionRunId?: string,
      cursor?: ScheduleCursor,
      acceptedViewerRequests?: string[],
    ) => Promise<PlannedScene | null>;
    markPlaying: (
      id: string | null,
      text: string,
      author: string,
      startsSegment: boolean,
      table?: TableSnapshot,
      continuous?: boolean,
      segment?: SegmentRun,
    ) => Promise<void>;
    markPlayed: (id: string | null) => Promise<void>;
    releasePrompt: (id: string | null) => Promise<void>;
    reportBridgeState: (status: "starting" | "live" | "degraded", detail?: string, recovery?: BridgeRecovery) => Promise<void>;
  }
}

function clipPrompt(message: ReactorMessage): Prompt | null {
  const payload = message.data as ClipPayload;
  const metadata = payload.clip?.metadata;
  if (!metadata) return null;
  try {
    const value = JSON.parse(metadata) as Prompt;
    return typeof value.text === "string" ? value : null;
  } catch {
    return null;
  }
}

function queuedClip(value: unknown): QueuedClip | null {
  if (!value || typeof value !== "object") return null;
  const clip = value as { clip_id?: unknown; metadata?: unknown };
  if (typeof clip.clip_id !== "string" || typeof clip.metadata !== "string") return null;
  try {
    const prompt = JSON.parse(clip.metadata) as Prompt;
    return typeof prompt.text === "string" ? { ...prompt, clipId: clip.clip_id } : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const config = await window.runtimeConfig();
  const room = new Room({ adaptiveStream: false, dynacast: false });
  await room.connect(config.livekitUrl, config.livekitToken, { autoSubscribe: false });

  const reactor: Reactor = new Reactor({
    modelName: config.reactorModel,
    jwt: config.reactorLocal ? undefined : () => window.reactorToken(reactor.getSessionId()),
    local: config.reactorLocal,
    apiUrl: config.reactorLocal ? config.reactorLocalUrl : undefined,
    autoResumeTracks: true,
  });

  let pumping = false;
  let failed = false;
  let uploadingFrame = false;
  let plannerFailures = 0;
  let retryPending = false;
  let scheduleCursor: ScheduleCursor | undefined;
  const pendingClips = new Map<string, Prompt>();
  let initialized = false;
  let lastQueuedClipId: string | null = null;
  let hasSegment = false;
  let activeChunkSeconds = config.clipSeconds;
  let storyHistory: StoryHistoryItem[] = [];
  let acceptedViewerRequests: string[] = [];
  let activeContinuityNotes = "";
  let activeVoicePrompt = "";
  let activeInteractionRunId: string | undefined;
  let queuedClips: QueuedClip[] = [];
  let pendingImmediateClipId: string | null = null;
  let playingClipId: string | null = null;
  let playbackDeadline = 0;
  let playingPrompt: Prompt | null = null;
  let playbackWrites = Promise.resolve();
  const writePlayback = (action: () => Promise<void>) => {
    playbackWrites = playbackWrites.then(action).catch(async () => {
      failed = true;
      await window.reportBridgeState("degraded", "Could not synchronize playback and audience voting. Restart the stream to recover.");
    });
  };
  const audioElements: HTMLAudioElement[] = [];
  const audioStreams: MediaStream[] = [];
  let sourceVideo: MediaStreamTrack | null = null;
  window.mediaHealth = async () => {
    const incoming: MediaHealthSample["incoming"] = [];
    const outgoing: MediaHealthSample["outgoing"] = [];
    const peer = reactor.getPeerConnection();
    const report = await peer?.getStats();
    report?.forEach(stat => {
      if (stat.type === "inbound-rtp" && stat.kind === "video" && typeof stat.framesDecoded === "number") {
        incoming.push({ id: stat.id, frames: stat.framesDecoded });
      }
    });
    for (const publication of room.localParticipant.videoTrackPublications.values()) {
      const stats = await publication.videoTrack?.getRTCStatsReport();
      stats?.forEach(stat => {
        if (stat.type === "outbound-rtp" && stat.kind === "video" && typeof stat.framesEncoded === "number") {
          outgoing.push({ id: stat.id, frames: stat.framesEncoded });
        }
      });
    }
    return {
      connected: room.state === "connected" && peer?.connectionState === "connected"
        && sourceVideo?.readyState === "live" && !sourceVideo.muted,
      playing: playingClipId !== null && Date.now() < playbackDeadline,
      incoming, outgoing,
    };
  };
  window.mediaStats = async () => {
    const source = sourceVideo?.getSettings();
    const incoming: Record<string, unknown>[] = [];
    const sourceReport = await reactor.getPeerConnection()?.getStats();
    sourceReport?.forEach(stat => {
      if (stat.type !== "inbound-rtp" || stat.kind !== "video") return;
      incoming.push({ width: stat.frameWidth, height: stat.frameHeight, fps: stat.framesPerSecond,
        framesDecoded: stat.framesDecoded, framesDropped: stat.framesDropped,
        packetsLost: stat.packetsLost, jitter: stat.jitter, freezeCount: stat.freezeCount });
    });
    const outbound: Record<string, unknown>[] = [];
    for (const publication of room.localParticipant.videoTrackPublications.values()) {
      const report = await publication.videoTrack?.getRTCStatsReport();
      report?.forEach(stat => {
        if (stat.type !== "outbound-rtp" || stat.kind !== "video") return;
        outbound.push({ width: stat.frameWidth, height: stat.frameHeight, fps: stat.framesPerSecond,
          framesEncoded: stat.framesEncoded, bytesSent: stat.bytesSent,
          qualityLimitationReason: stat.qualityLimitationReason,
          qualityLimitationDurations: stat.qualityLimitationDurations });
      });
    }
    return { source: source ? { width: source.width, height: source.height, frameRate: source.frameRate } : null, incoming, outbound };
  };

  const prepareAudioTrack = async (track: MediaStreamTrack): Promise<MediaStreamTrack> => {
    const element = document.createElement("audio") as CapturableAudioElement;
    element.autoplay = true;
    element.srcObject = new MediaStream([track]);
    document.body.append(element);
    await element.play();
    const stream = element.captureStream();
    const outgoingTrack = stream.getAudioTracks()[0];
    if (!outgoingTrack) throw new Error("Could not capture Reactor audio playback");
    audioElements.push(element);
    audioStreams.push(stream);
    return outgoingTrack;
  };

  const pump = async () => {
    if (!initialized || pumping || failed || retryPending || pendingClips.size >= 3) return;
    pumping = true;
    try {
      // One playing clip plus two queued clips lets planning overlap generation.
      while (!failed && pendingClips.size < 3) {
        await playbackWrites;
        if (failed) break;
        const settings = await window.getBroadcastSettings();
        let scene: PlannedScene | null;
        try {
          scene = await window.planScene(
          storyHistory.slice(-6),
          settings.chunkSeconds,
          activeContinuityNotes || undefined,
          activeVoicePrompt || undefined,
          activeInteractionRunId,
          scheduleCursor,
          acceptedViewerRequests,
          );
        } catch (error) {
          plannerFailures++;
          const reason = error instanceof Error ? error.message : String(error);
          if (failed) break;
          if (reason.includes(SCENE_SAFETY_FAILURE)) {
            failed = true;
            await window.reportBridgeState("degraded", "Scene rejected by broadcast safety; clearing the model session.", "restart");
            break;
          }
          const delayMs = plannerRetryDelay(plannerFailures);
          retryPending = true;
          await window.reportBridgeState("degraded",
            `Retrying scene planning (attempt ${plannerFailures}) in ${delayMs / 1000}s: ${reason}`, "retrying");
          setTimeout(() => { retryPending = false; void pump(); }, delayMs);
          break;
        }
        if (failed) break;
        if (!scene) {
          await window.reportBridgeState("starting", "No enabled segments. Add one in Admin > Schedule.");
          setTimeout(() => void pump(), 1_000);
          break;
        }
        const requestedSeconds = scene.plannedChunkSeconds ?? settings.chunkSeconds;
        if (requestedSeconds !== activeChunkSeconds) {
          activeChunkSeconds = requestedSeconds;
          await reactor.sendCommand("set_clip_seconds", { seconds: activeChunkSeconds });
        }
        if (scene.playNow) {
          // Remove dependents before their sources when a chain is still building.
          const staleClips = [...queuedClips].reverse();
          queuedClips = [];
          // The on-air clip can finish while its replacement is generating.
          for (const id of pendingClips.keys()) if (id !== playingClipId) pendingClips.delete(id);
          for (const stale of staleClips) {
            await reactor.sendCommand("pop", { clip_id: stale.clipId });
            if (stale.id !== playingPrompt?.id) await window.releasePrompt(stale.id);
            await window.voteDiscard?.(stale.clipId);
          }
        }
        let openingFrame: unknown | null = null;
        const customSegment = Boolean(scene.startsSegment || scene.playNow || scene.openingFrameUrl);
        if (scene.openingFrameUrl) {
          const frameResponse = await fetch(scene.openingFrameUrl, { cache: "no-store" });
          if (!frameResponse.ok) throw new Error("The segment opening frame is unavailable");
          const frame = await frameResponse.blob();
          uploadingFrame = true;
          try {
            openingFrame = await withUploadAuthRetry(
              () => reactor.uploadFile(frame, { name: `segment-${scene.id || "opening"}.webp` }),
              () => window.reactorToken(reactor.getSessionId(), true),
            );
          } finally { uploadingFrame = false; }
        }
        if (customSegment) {
          lastQueuedClipId = null;
          storyHistory = [];
          activeContinuityNotes = scene.continuityNotes || "";
          activeVoicePrompt = scene.voicePrompt || "";
          activeInteractionRunId = scene.interactionRunId;
        }
        const startsSegment = !hasSegment || customSegment;
        hasSegment = true;
        const nextCursor = customSegment || !scheduleCursor
          ? { ...(scene.segment ?? { chunkSeconds: scene.chunkSeconds, id: scheduleCursor?.id, title: "Workshop segment", durationSeconds: scheduleCursor?.durationSeconds ?? 300 }), runId: scene.runId, elapsedSeconds: 0 }
          : scheduleCursor;
        const payload = enqueuePayload(
          { ...scene, segment: { chunkSeconds: activeChunkSeconds, id: nextCursor.id, title: nextCursor.title, durationSeconds: nextCursor.durationSeconds }, continuous: false },
          activeChunkSeconds,
          lastQueuedClipId,
          openingFrame,
          startsSegment,
        );
        if (scene.playNow) payload.position = 0;
        const traceId = crypto.randomUUID();
        await window.debugPrompt("sent", traceId, payload).catch(() => undefined);
        const reply = await reactor.sendCommand("enqueue", payload);
        const clip = clipFromMessageData(reply?.data);
        await window.debugPrompt("accepted", traceId, clip).catch(() => undefined);
        if (!clip) {
          const replyData = reply?.data && typeof reply.data === "object"
            ? reply.data as { error?: unknown; message?: unknown; reason?: unknown }
            : null;
          const replyDetail = [replyData?.reason, replyData?.message, replyData?.error]
            .find((value): value is string => typeof value === "string" && Boolean(value.trim()));
          const detail = replyDetail || reactor.getLastError()?.message || "FastH3 did not accept the planned scene";
          throw new Error(detail);
        }
        if (scene.playNow) pendingImmediateClipId = clip.clip_id;
        pendingClips.set(clip.clip_id, JSON.parse(String(payload.metadata)) as Prompt);
        if (scene.runId) await window.voteAccepted?.(clip.clip_id, scene.runId, nextCursor.title, scene.voteOptions, scene.voteDurationChunks ?? settings.voteDurationChunks ?? 2, scene.voteWinnerRoundId);
        if (startsSegment) acceptedViewerRequests = [];
        if (scene.viewerOverride) acceptedViewerRequests = [...acceptedViewerRequests, scene.text].slice(-4);
        scheduleCursor = { ...nextCursor, elapsedSeconds: nextCursor.elapsedSeconds + activeChunkSeconds };
        if (plannerFailures) {
          plannerFailures = 0;
          await window.reportBridgeState(playingClipId ? "live" : "starting", playingClipId ? "Live transmission" : "Generating scheduled segment");
        }
        lastQueuedClipId = clip.clip_id;
        storyHistory = [...storyHistory, {
          sceneSummary: scene.sceneSummary,
          dialogue: scene.dialogue,
          videoPrompt: scene.videoPrompt,
        }].slice(-8);
      }
    } catch (error) {
      failed = true;
      await window.reportBridgeState("degraded", error instanceof Error ? error.message : String(error));
    } finally {
      pumping = false;
    }
  };

  reactor.on("trackReceived", async (name, track) => {
    if (name !== "main_video" && name !== "main_audio") return;
    if (name === "main_video") sourceVideo = track;
    const outgoingTrack = name === "main_audio" ? await prepareAudioTrack(track) : track;
    await room.localParticipant.publishTrack(outgoingTrack, {
      name,
      source: name === "main_video" ? Track.Source.Camera : Track.Source.Microphone,
      simulcast: false,
      degradationPreference: "maintain-resolution",
      videoEncoding:
        name === "main_video" ? { maxBitrate: config.videoBitrate, maxFramerate: 24 } : undefined,
    });
    if (name === "main_video" && !failed && !plannerFailures) await window.reportBridgeState("starting", "Connected. Preparing scheduled segment");
  });

  reactor.on("message", (message) => {
    const debugClip = clipFromMessageData(message.data);
    if (debugClip) void window.debugPrompt("state", debugClip.clip_id, { type: message.type, seconds: debugClip.seconds }).catch(() => undefined);
    if (message.type === "queue_update") {
      const value = message.data as { generation?: unknown[]; playout?: unknown[] };
      queuedClips = [...(value.generation || []), ...(value.playout || [])]
        .map(queuedClip)
        .filter((clip): clip is QueuedClip => clip !== null);
      void pump();
    } else if (message.type === "clip_generated") {
      const clip = clipFromMessageData(message.data);
      if (clip && clip.clip_id === pendingImmediateClipId) {
        pendingImmediateClipId = null;
        const playingBefore = playingClipId;
        const promptBefore = playingPrompt;
        void reactor.sendCommand("move", { clip_id: clip.clip_id, position: 0 }).then(async () => {
          if (playingBefore && playingBefore !== clip.clip_id) {
            await reactor.sendCommand("stop", {});
            if (promptBefore) await window.markPlayed(promptBefore.id);
          }
        });
      }
    } else if (message.type === "clip_started") {
      const startedClip = clipFromMessageData(message.data);
      const nextId = startedClip?.clip_id || null;
      if (playingClipId && nextId && playingClipId !== nextId) pendingClips.delete(playingClipId);
      playingClipId = nextId;
      const prompt = clipPrompt(message) ?? (playingClipId ? pendingClips.get(playingClipId) ?? null : null);
      const seconds = startedClip?.seconds ?? prompt?.segment?.chunkSeconds ?? config.clipSeconds;
      playbackDeadline = Date.now() + Math.max(0, Math.min(15, seconds)) * 1000;
      playingPrompt = prompt;
      const startedId = playingClipId;
      if (prompt) writePlayback(async () => {
        if (startedId && prompt.runId) await window.votePlayback?.("start", startedId, prompt.runId);
        await window.markPlaying(
        prompt.id,
        prompt.text,
        prompt.author,
        Boolean(prompt.startsSegment),
        prompt.table,
        prompt.continuous,
        prompt.segment,
        );
      });
    } else if (message.type === "clip_finished") {
      const finishedId = clipFromMessageData(message.data)?.clip_id;
      const prompt = clipPrompt(message) ?? (finishedId ? pendingClips.get(finishedId) ?? null : null);
      if (finishedId && pendingClips.delete(finishedId)) {
        if (playingClipId === finishedId) {
          playingClipId = null;
          playingPrompt = null;
        }
        writePlayback(async () => {
          if (prompt?.runId) await window.votePlayback?.("finish", finishedId, prompt.runId);
          if (prompt) await window.markPlayed(prompt.id);
          void pump();
        });
      }
    } else if (message.type === "clip_stopped") {
      const stoppedId = clipFromMessageData(message.data)?.clip_id ?? playingClipId;
      const stoppedPrompt = clipPrompt(message) ?? (stoppedId === playingClipId ? playingPrompt : null);
      if (stoppedId) pendingClips.delete(stoppedId);
      if (stoppedId === playingClipId) {
        playingClipId = null;
        playingPrompt = null;
      }
      if (stoppedPrompt) writePlayback(async () => {
        await window.markPlayed(stoppedPrompt.id);
      });
    } else if (message.type === "clip_failed") {
      failed = true;
      void window.reportBridgeState("degraded", "Clip generation failed; refusing to continue from a missing anchor");
    }
  });

  reactor.on("statusChanged", (status) => {
    if (status === "disconnected") void window.reportBridgeState("degraded", "Reactor disconnected");
  });
  reactor.on("error", (error) => {
    // The upload promise owns its bounded auth retry and terminal failure report.
    if (uploadingFrame && isUploadAuthenticationError(error)) return;
    void window.reportBridgeState("degraded", error.message);
  });
  room.on(RoomEvent.Disconnected, () => void window.reportBridgeState("degraded", "LiveKit disconnected"));

  await window.reportBridgeState("starting", "Connecting to Reactor");
  await reactor.connect();
  await reactor.resumeTrack("main_audio");
  await reactor.resumeTrack("main_video");
  await reactor.sendCommand("set_canvas", { aspect: "16:9" });
  await reactor.sendCommand("set_clip_seconds", { seconds: config.clipSeconds });
  await reactor.sendCommand("set_flush_on_clip_end", { enabled: false });
  initialized = true;
  await pump();
  await reactor.sendCommand("set_autoplay", { enabled: true });
}

void main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  void window.reportBridgeState("degraded", detail);
});
