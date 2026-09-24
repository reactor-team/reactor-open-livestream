"use client";

import {
  promptTimings,
  activeViewerPrompt,
  orderedWaitingPrompts,
  displayedViewerCount,
  BROADCAST_WAITING_MESSAGE,
} from "@reactor/infinite-contracts";
import { useConvexConnectionState, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { RiDraftLine, RiLoader4Line, RiVolumeMuteFill, RiVolumeUpLine } from "@remixicon/react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import PartnerActions from "@/components/partner-actions";
import { Logo } from "@/components/reactor-ui";
import BroadcastHeader from "./broadcast-header";
import ChunkCountdown from "./chunk-countdown";
import { isFollowingChat, scrollChatToLatest } from "@/lib/chat-scroll";
import { api } from "../../../convex/_generated/api";
import { useBackend } from "../backend-context";
import { backendFetch } from "@/lib/backend-fetch";
import { useDevMode } from "../dev-mode";
import DevModeToggle from "./dev-mode-toggle";
import PromptInspector from "./prompt-inspector";
import SchedulePanel, { ScheduleButton, SegmentCountdown } from "./schedule-panel";
import SegmentWorkshop, { type SegmentQueueInput } from "./segment-workshop";
import SignalStatic from "./signal-static";
import TerminalSpinner from "./terminal-spinner";
import { useViewer } from "./use-viewer";
import ViewerName from "./viewer-name";
import OnAirPrompt from "./on-air-prompt";
import StreamStatus from "./stream-status";
import FullscreenToggle from "./fullscreen-toggle";
import SiteBanner from "./site-banner";
import { onAirViewerPrompt } from "@/lib/on-air-prompt";
import VotePanel from "./vote-panel";
import ChannelMessage from "./channel-message";
import ChatTimestamp from "./chat-timestamp";
import ChatPromptText from "./chat-prompt-text";
import { mergeVoteOutcomes } from "@/lib/chat-messages";
import type { Id } from "../../../convex/_generated/dataModel";
import { usePromptSubmission } from "./use-prompt-submission";
import { PrivatePromptMessage, PromptNotice } from "./private-prompt-message";
import { mergePrivatePrompts } from "@/lib/private-prompts";
import { promptUnavailableReason } from "@/lib/prompt-availability";
import PromptComposer from "./prompt-composer";
import { captureStreamEvent } from "@/lib/analytics";
import { useStreamAnalytics } from "./use-stream-analytics";
import ClipControls from "./clip-controls";
import ChatReactions, { ChatMessageMeta, MentionText, UserStars } from "./chat-social";
import MentionInput from "./mention-input";
import "./chat-social.css";
import "./schedule-arrival-toast.css";

type DevStreamState = {
  active: boolean;
  status: "offline" | "starting" | "live" | "degraded";
  detail?: string;
};



const usernameColors = [
  "var(--dune-light)",
  "var(--twilight-light)",
  "var(--glacier-light)",
  "var(--terra-light)",
  "var(--dawn-light)",
  "var(--urban)",
];

function usernameColor(identity: string): string {
  let hash = 0;
  for (let index = 0; index < identity.length; index += 1) {
    hash = (hash * 31 + identity.charCodeAt(index)) >>> 0;
  }
  return usernameColors[hash % usernameColors.length];
}

export default function BroadcastApp() {
  const broadcast = useQuery(api.broadcast.get);
  const settings = useQuery(api.settings.get);
  const schedule = useQuery(api.schedule.rundown);
  const activePrompts = useQuery(api.prompts.active);
  const { checking, acceptedOutstanding, entries: privatePrompts, notice, dismissNotice, showNotice, showBlockedNotice, submitPrompt } = usePromptSubmission();
  const { isWebSocketConnected } = useConvexConnectionState();
  const sendMessage = useMutation(api.chat.send);
  const {
    audioRef,
    connection,
    enableSound,
    identity,
    muted,
    legacyName,
    setVolume,
    soundEnabled,
    toggleMute,
    videoRef,
    viewerCount,
    volume,
  } = useViewer();
  const nameServiceAvailable = settings === undefined ? undefined : settings.viewerNamesRequired === true;
  const viewer = useQuery(api.viewers.get, identity && nameServiceAvailable ? { identity } : "skip");
  const setViewerName = useMutation(api.viewers.setName);
  const name = viewer?.name ?? "";
  const socialEnabled = settings?.chatSocialEnabled === true;
  const messages = useQuery(api.chat.recent);
  const reactionMessageIds = useMemo(() => messages?.filter(item => item.kind !== "system").map(item => item._id) ?? [], [messages]);
  const ownReactions = useQuery(api.chat.ownReactions, socialEnabled && identity ? { identity, messageIds: reactionMessageIds } : "skip");
  const reactToMessage = useMutation(api.chat.setReaction);
  const [mentionSearch, setMentionSearch] = useState<string | null>(null);
  const mentionSuggestions = useQuery(api.viewers.mentionSuggestions, socialEnabled && mentionSearch !== null ? { search: mentionSearch } : "skip");
  useEffect(() => {
    if (name) {
      try { localStorage.setItem("reactor-infinite-name", name); } catch { /* Convex owns the saved name. */ }
    }
  }, [name]);
  const voting = useQuery(api.voting.current, { identity: identity || undefined });
  const castVote = useMutation(api.voting.cast);
  const { enabled: devModeEnabled, environment: devEnvironment } = useDevMode();
  const [prompt, setPrompt] = useState("");
  const promptInput = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState("");
  const [chatError, setChatError] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatInFlight = useRef(false);
  const chatBlockedExplanation = useRef<string | null>(null);
  const [devStreamActive, setDevStreamActive] = useState(false);
  const [devStreamBusy, setDevStreamBusy] = useState(false);
  const [devStreamError, setDevStreamError] = useState("");
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [segmentJobRunning, setSegmentJobRunning] = useState(false);
  const chatScroll = useRef<HTMLDivElement | null>(null);
  const followChat = useRef(true);
  const [chatPaused, setChatPaused] = useState(false);

  const backend = useBackend();
  const isLocalDevelopment = devEnvironment === "local" && backend.target === "local";
  const status = broadcast?.status ?? "offline";
  const streamReady = status === "live" && connection === "live";
  useStreamAnalytics(videoRef, streamReady, status);
  const onAirPrompt = onAirViewerPrompt({ ready: streamReady, prompts: activePrompts,
    currentPrompt: broadcast?.currentPrompt, currentAuthor: broadcast?.currentAuthor });
  const [timingNow, setTimingNow] = useState(0);
  const queuedPromptIds = useMemo(() => activePrompts === undefined ? undefined : orderedWaitingPrompts(activePrompts).map(prompt => prompt._id), [activePrompts]);
  const hasWaitingPrompts = Boolean(queuedPromptIds?.length);
  useEffect(() => {
    if (!hasWaitingPrompts) return;
    const timer = window.setInterval(() => setTimingNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasWaitingPrompts]);
  const promptEstimates = useMemo(() => promptTimings({
    prompts: activePrompts ?? [], timing: broadcast?.queueTiming, now: timingNow, status,
    chunkSeconds: broadcast?.segment?.chunkSeconds ?? settings?.chunkSeconds ?? 10,
    voting: settings?.interactionMode === "voting",
  }), [activePrompts, broadcast?.queueTiming, broadcast?.segment?.chunkSeconds, settings?.chunkSeconds, settings?.interactionMode, status, timingNow]);
  const ownPrompt = activeViewerPrompt(activePrompts, identity);
  const ownQueueLabel = ownPrompt ? promptEstimates.get(ownPrompt._id)?.queueLabel : undefined;
  const promptBlockedReason = promptUnavailableReason({
    connected: isWebSocketConnected, identity, settingsLoaded: settings !== undefined,
    namesAvailable: nameServiceAvailable === true, viewerLoaded: viewer !== undefined, name,
    voting: settings?.interactionMode === "voting", checking, queueLoaded: activePrompts !== undefined,
    acceptedOutstanding, ownPromptStatus: ownPrompt?.status, queueLabel: ownQueueLabel,
  });
  const devStreamLabel = devStreamBusy
    ? (devStreamActive ? "Stopping" : "Starting")
    : (devStreamActive ? "Stop stream" : "Manually Start stream [LOCAL DEV ONLY]");
  const orderedMessages = useMemo(() => mergePrivatePrompts(
    mergeVoteOutcomes([...(messages ?? [])].reverse()), privatePrompts,
  ), [messages, privatePrompts]);
  const newestMessageId = orderedMessages.at(-1)?._id;
  function pauseChatForReading() {
    followChat.current = false;
    setChatPaused(true);
  }
  useEffect(() => {
    if (!newestMessageId) return;
    if (!followChat.current) return;
    const frame = requestAnimationFrame(() => scrollChatToLatest(chatScroll.current));
    return () => cancelAnimationFrame(frame);
  }, [newestMessageId, orderedMessages]);

  useEffect(() => {
    if (!scheduleOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setScheduleOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [scheduleOpen]);

  useEffect(() => {
    if (!isLocalDevelopment) return;
    let cancelled = false;
    const refresh = () => {
      void backendFetch("/api/dev/stream", { cache: "no-store" })
        .then(async (response) => (await response.json()) as DevStreamState)
        .then((state) => {
          if (!cancelled) setDevStreamActive(state.active);
        })
        .catch(() => {
          if (!cancelled) setDevStreamError("Local broadcaster unavailable");
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isLocalDevelopment]);

  useEffect(() => {
    if (!isLocalDevelopment || !devStreamActive) return;
    let lastSentAt = 0;
    const keepAlive = () => {
      const now = Date.now();
      if (now - lastSentAt < 15_000) return;
      lastSentAt = now;
      void backendFetch("/api/dev/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "keepalive" }),
      })
        .then(async (response) => (await response.json()) as DevStreamState)
        .then((state) => setDevStreamActive(state.active))
        .catch(() => undefined);
    };
    const events: Array<keyof WindowEventMap> = ["keydown", "pointerdown", "pointermove", "wheel"];
    for (const event of events) window.addEventListener(event, keepAlive, { passive: true });
    return () => {
      for (const event of events) window.removeEventListener(event, keepAlive);
    };
  }, [devStreamActive, isLocalDevelopment]);

  async function requestDevStream(action: "start" | "stop"): Promise<void> {
    setDevStreamBusy(true);
    setDevStreamError("");
    try {
      const response = await backendFetch("/api/dev/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const state = (await response.json()) as DevStreamState;
      setDevStreamActive(state.active);
      if (!response.ok) throw new Error(state.detail || `Could not ${action} stream`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : `Could not ${action} stream`;
      setDevStreamError(message);
      throw new Error(message);
    } finally {
      setDevStreamBusy(false);
    }
  }

  async function toggleDevStream(): Promise<void> {
    await requestDevStream(devStreamActive ? "stop" : "start").catch(() => undefined);
  }

  async function onPrompt(event: FormEvent) {
    event.preventDefault();
    const reason = promptBlockedReason || (!prompt.trim() ? "Write a prompt first." : null);
    if (reason) { showBlockedNotice(reason); return; }
    const text = prompt;
    followChat.current = true;
    setChatPaused(false);
    if (await submitPrompt({ text, author: name, identity })) {
      setPrompt(current => current === text ? "" : current);
    }
  }

  async function onChat(event: FormEvent) {
    event.preventDefault();
    const command = message.trim().match(/^[!/]prompt(?:\s+([\s\S]*))?$/i);
    const reason = command
      ? promptBlockedReason || (!command[1]?.trim() ? "Add your idea after /prompt." : null)
      : !identity || !name ? "Choose a name above the chat box before sending a message."
        : !isWebSocketConnected ? "Reconnecting to chat. Your draft is safe. Please try again when connected."
          : !message.trim() ? "Write a message first." : null;
    if (reason || chatInFlight.current) {
      const feedback = reason || "Your previous message is still sending. Please wait for confirmation.";
      setChatError(feedback);
      if (command) showBlockedNotice(feedback);
      return;
    }
    chatInFlight.current = true;
    setChatSending(true);
    setChatError("");
    const text = message;
    try {
      if (command) {
        const accepted = await submitPrompt({ text: command[1], author: name, identity }, "chat");
        if (!accepted) return;
      }
      else {
        await sendMessage({ body: text, author: name, identity });
        captureStreamEvent("chat_result", { outcome: "sent" });
      }
      setMessage(current => current === text ? "" : current);
      followChat.current = true;
      setChatPaused(false);
      requestAnimationFrame(() => scrollChatToLatest(chatScroll.current));
    } catch (cause) {
      if (!command) captureStreamEvent("chat_result", { outcome: "failed" });
      setChatError(cause instanceof ConvexError && typeof cause.data === "string" ? cause.data : "Could not send your message. Please try again.");
    } finally {
      chatInFlight.current = false;
      setChatSending(false);
    }
  }

  async function queueWorkshopPrompt(input: SegmentQueueInput): Promise<void> {
    const playNow = input.action === "play";
    if (!identity) throw new Error("Viewer identity is not ready.");
    if (!playNow && !name) throw new Error("Choose a name above chat first.");
    if (playNow) setWorkshopOpen(false);
    try {
      const response = await backendFetch("/api/dev/segment/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: input.action,
          chunkSeconds: input.chunkSeconds,
          text: input.text,
          author: name || "Reactor",
          identity,
          imageDataUrl: input.openingFrameDataUrl,
          continuityNotes: input.continuityNotes,
          voicePrompt: input.voicePrompt,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: unknown };
      if (!response.ok) {
        throw new Error(typeof result.error === "string" ? result.error : "Could not queue segment");
      }
      if (playNow && isLocalDevelopment && !devStreamActive) {
        await requestDevStream("start");
      }
    } catch (error) {
      if (playNow) setWorkshopOpen(true);
      throw error;
    }
  }

  const banner = settings?.banner?.trim() ?? "";
  return (
    <main
      className={`broadcast-shell${banner ? " has-site-banner" : ""}`}
      data-dev-mode={devModeEnabled || undefined}
    >
      {banner ? <SiteBanner key={banner} text={banner} /> : null}
      <BroadcastHeader>
        {devModeEnabled && devEnvironment === "local" ? <PromptInspector /> : null}
        <DevModeToggle />
        <PartnerActions />
      </BroadcastHeader>

      <section className="stage">
        <div className="player-column">
          <div className="player-frame">
            <div className="player-media">
              <video ref={videoRef} data-ready={streamReady || undefined} autoPlay playsInline muted />
              <SignalStatic ready={streamReady} />
              <audio ref={audioRef} autoPlay muted={!soundEnabled || muted} />
              {!soundEnabled ? (
                <button className="sound-gate" onClick={enableSound} aria-label="Enable stream sound" />
              ) : null}
              {!streamReady ? (
                <div className="player-empty">
                  <div className="waiting-lockup">
                    <Logo variant="combined" color="white" className="waiting-logo" aria-hidden />
                    <div className="waiting-status" role="status">
                      {status === "starting" || status === "live" || !broadcast ? <TerminalSpinner /> : null}
                      <strong>{BROADCAST_WAITING_MESSAGE}</strong>
                    </div>
                    {devModeEnabled && isLocalDevelopment && !devStreamActive && !devStreamBusy ? (
                      <div className="dev-stream-launch">
                        <button
                          className="dev-stream-button"
                          data-active={devStreamActive || undefined}
                          disabled={devStreamBusy}
                          onClick={() => void toggleDevStream()}
                          title={devStreamError || undefined}
                          type="button"
                        >
                          {devStreamLabel}
                        </button>
                        <span>Stream autoconnects in production</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {!soundEnabled ? (
                <span className="sound-gate-badge" aria-hidden="true">
                  <RiVolumeUpLine />
                  <span>Tap to enable sound</span>
                </span>
              ) : null}
            </div>
            <div className="stream-controls" data-prompt={Boolean(onAirPrompt) || undefined} role="group" aria-label="Stream controls">
              <div className="stream-control-group stream-control-status">
                <StreamStatus status={streamReady ? "live" : status === "live" || !broadcast ? "starting" : status} viewerCount={displayedViewerCount(viewerCount, settings)} />
              </div>
              <div className="stream-timers" role="group" aria-label="Playback timers">
                {streamReady && broadcast?.currentChunkStartedAt ? (
                  <ChunkCountdown
                    chunkSeconds={broadcast?.segment?.chunkSeconds ?? settings?.chunkSeconds ?? 10}
                    startedAt={broadcast.currentChunkStartedAt}
                  />
                ) : null}
                <SegmentCountdown
                  segment={broadcast?.segment}
                  startedAt={broadcast?.currentSegmentStartedAt}
                  status={status}
                />
              </div>
              <OnAirPrompt prompt={onAirPrompt} />
              {devModeEnabled && backend.target !== "staging" ? (
                <button
                  className="dev-workshop-button"
                  data-open={workshopOpen || undefined}
                  onClick={() => {
                    setScheduleOpen(false);
                    setWorkshopOpen((open) => !open);
                  }}
                  type="button"
                >
                  {segmentJobRunning
                    ? <RiLoader4Line aria-hidden="true" className="is-spinning" />
                    : <RiDraftLine aria-hidden="true" />}
                  {segmentJobRunning ? "Generating" : "Segments"}
                </button>
              ) : null}
              {devModeEnabled && isLocalDevelopment && (devStreamActive || devStreamBusy) ? (
                <button
                  className="dev-stream-button"
                  data-active={devStreamActive || undefined}
                  disabled={devStreamBusy}
                  onClick={() => void toggleDevStream()}
                  title={devStreamError || undefined}
                  type="button"
                >
                  {devStreamLabel}
                </button>
              ) : null}
              <div className="stream-control-group stream-control-actions">
                <ScheduleButton
                  queuedPromptIds={queuedPromptIds}
                  prompts={activePrompts}
                  notifyArrivals={isWebSocketConnected && !workshopOpen}
                  onClick={() => {
                    if (!scheduleOpen) captureStreamEvent("schedule_opened");
                    setWorkshopOpen(false);
                    setScheduleOpen((open) => !open);
                  }}
                  open={scheduleOpen}
                />
                {soundEnabled ? (
                  <div className="volume-control" data-muted={muted || undefined}>
                    <button
                      aria-label={muted ? "Unmute stream" : "Mute stream"}
                      aria-pressed={muted}
                      className="volume-toggle"
                      data-muted={muted || undefined}
                      onClick={toggleMute}
                      title={muted ? "Unmute" : "Mute"}
                      type="button"
                    >
                      {muted ? <RiVolumeMuteFill aria-hidden="true" /> : <RiVolumeUpLine aria-hidden="true" />}
                    </button>
                    <span>Volume</span>
                    <input aria-label="Volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
                  </div>
                ) : (
                  <button className="volume-toggle sound-enable-toggle" aria-label="Enable stream sound" onClick={enableSound} type="button">
                    <RiVolumeMuteFill aria-hidden="true" />
                  </button>
                )}
                <ClipControls videoRef={videoRef} audioRef={audioRef} live={streamReady} />
                <FullscreenToggle />
              </div>
            </div>
            <SchedulePanel
              segment={broadcast?.segment}
              currentSegmentStartedAt={broadcast?.currentSegmentStartedAt}
              schedule={schedule ?? []}
              promptEstimates={promptEstimates}
              currentAuthor={broadcast?.currentAuthor}
              currentPrompt={broadcast?.currentPrompt}
              onClose={() => setScheduleOpen(false)}
              open={scheduleOpen}
              prompts={activePrompts ?? []}
              status={status}
              usernameColor={usernameColor}
              voting={voting}
            />
            {devModeEnabled && backend.target !== "staging" ? (
              <SegmentWorkshop
                chunkSeconds={broadcast?.segment?.chunkSeconds ?? settings?.chunkSeconds ?? 10}
                onClose={() => setWorkshopOpen(false)}
                onGeneratingChange={setSegmentJobRunning}
                onQueue={queueWorkshopPrompt}
                open={workshopOpen}
              />
            ) : null}
            <div className="player-prompt">
              {settings?.interactionMode === "voting" ? <VotePanel voting={voting} live={streamReady}
                onVote={async (roundId, option) => {
                  try {
                    if (!identity) throw new Error("Viewer not ready");
                    await castVote({ roundId: roundId as Id<"voteRounds">, identity, option });
                    captureStreamEvent("vote_result", { outcome: "accepted" });
                  } catch (error) {
                    captureStreamEvent("vote_result", { outcome: "failed" });
                    throw error;
                  }
                }} /> : <>
              <PromptComposer value={prompt} onChange={setPrompt} onSubmit={onPrompt}
                onSetName={() => document.getElementById("viewer-name")?.focus()}
                onBlocked={showBlockedNotice} blockedReason={promptBlockedReason}
                hasName={Boolean(name)} checking={checking} inputRef={promptInput} />
              </>}
            </div>

          </div>

        </div>

        <aside className="chat-panel">
          <header><span className="system-label">Chat</span>
            {chatPaused ? <button className="chat-latest" type="button" onClick={() => {
              followChat.current = true;
              setChatPaused(false);
              scrollChatToLatest(chatScroll.current);
            }}>Latest messages ↓</button> : null}
          </header>
          <div className="chat-scroll" ref={chatScroll} tabIndex={0} role="region" aria-label="Chat messages"
            onScroll={event => {
              followChat.current = isFollowingChat(event.currentTarget);
              setChatPaused(!followChat.current);
            }}>
            <ol>
              {orderedMessages.map((item) => {
                if (item.kind === "private-prompt") return <PrivatePromptMessage key={item._id} entry={item} onExpand={pauseChatForReading} onEdit={text => {
                  setPrompt(text);
                  promptInput.current?.focus();
                }} />;
                if (item.kind === "system") return <ChannelMessage key={item._id} event={item} />;
                const timing = item.kind === "prompt"
                  ? promptEstimates.get(item.promptId ?? "") ?? { label: item.promptStatus === "played" ? "Aired" : item.promptStatus === "playing" ? "Playing now" : "In queue" }
                  : null;
                return (
                  <li className={item.kind === "prompt" ? "chat-message chat-prompt" : "chat-message"} key={item._id}
                    data-mentioned={item.mentions?.some(mention => mention.identity === identity) || undefined}>
                    <ChatTimestamp createdAt={item.createdAt} />
                    <strong style={{ color: usernameColor(item.identity) }}>{item.author}</strong><UserStars count={item.stars ?? 0} />{" "}
                    <span className="chat-message-body">
                      {item.kind === "prompt" ? <b>/prompt</b> : null}
                      {item.kind === "prompt" ? <ChatPromptText text={item.body} onExpand={pauseChatForReading} mentions={item.mentions} identity={identity} /> : <MentionText text={item.body} mentions={item.mentions} identity={identity} />}
                    </span>
                    <ChatMessageMeta timing={timing} status={item.kind === "prompt" ? item.promptStatus : undefined}>
                      {socialEnabled ? <ChatReactions counts={item.reactionCounts} selected={ownReactions?.[item._id]}
                      onOpen={pauseChatForReading} onReact={async (key, active) => {
                        if (!identity || !name) throw new ConvexError("Choose a name above the chat box before reacting.");
                        if (!isWebSocketConnected) throw new ConvexError("Reconnecting to chat. Please try again when connected.");
                        if (!ownReactions) throw new ConvexError("Your reactions are still loading. Please try again in a moment.");
                        await reactToMessage({ messageId: item._id, identity, author: name, key, active });
                      }} onError={cause => showNotice("Reaction unavailable", cause instanceof ConvexError && typeof cause.data === "string" ? cause.data : "Could not save your reaction. Please try again.")} /> : null}
                    </ChatMessageMeta>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="chat-footer">
            <ViewerName key={`${identity}:${legacyName}`} name={viewer?.name} canChangeAt={viewer?.canChangeAt} legacyName={legacyName}
              available={nameServiceAvailable} onSave={async chosen => {
                await setViewerName({ identity, name: chosen });
                captureStreamEvent("name_saved");
              }} />
            <form onSubmit={onChat}>
              <div className="chat-compose">
                <MentionInput value={message} onChange={text => {
                  setMessage(text); setChatError("");
                  const reason = /^[!/]prompt(?:\s|$)/i.test(text.trim()) ? promptBlockedReason : null;
                  if (reason && chatBlockedExplanation.current !== reason) showBlockedNotice(reason);
                  chatBlockedExplanation.current = reason;
                }} onBlur={() => { chatBlockedExplanation.current = null; }} suggestions={mentionSuggestions} onSearch={setMentionSearch} onError={reason => showNotice("Message too long", reason)}
                  placeholder={!name ? "Set your name above to join in" : "Say something or type /prompt"} />
                <button type="submit" aria-label="Send message" aria-busy={chatSending}>Send</button>
              </div>
              {chatError ? <p className="viewer-name-error" role="alert">{chatError}</p> : null}
            </form>
          </div>
        </aside>
      </section>

      {notice ? <PromptNotice notice={notice} onDismiss={dismissNotice} dismissLabel="Dismiss notification" /> : null}
    </main>
  );
}
