"use client";

import {
  type BroadcastStatus,
  orderedWaitingPrompts,
  type PromptStatus,
  type PromptTiming,
  type SegmentRun,
  type PublicVoting,
} from "@reactor/infinite-contracts";
import { RiArrowDownSLine, RiCalendar2Line, RiCloseLine, RiQuestionLine } from "@remixicon/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import InfoPopover from "./info-popover";
import ScheduleQueueCount from "./schedule-queue-count";
import { queuedPromptDescription } from "@/lib/queue-count";
import ScheduleArrivalToast from "./schedule-arrival-toast";
import type { SchedulePrompt } from "@/lib/schedule-arrival";

type ActivePrompt = {
  _id: string;
  text: string;
  author: string;
  identity: string;
  status: PromptStatus;
  playNow?: boolean;
  createdAt: number;
  _creationTime?: number;
  queuedAt?: number;
  startedAt?: number;
};

type SchedulePanelProps = {
  voting?: PublicVoting;
  segment?: SegmentRun;
  currentSegmentStartedAt?: number;
  schedule: { _id: string; title: string; durationSeconds: number }[];
  promptEstimates: Map<string, PromptTiming>;
  currentAuthor?: string;
  currentPrompt?: string;
  onClose: () => void;
  open: boolean;
  prompts: ActivePrompt[];
  status: BroadcastStatus;
  usernameColor: (identity: string) => string;
};

type SegmentCountdownProps = {
  segment?: SegmentRun;
  startedAt?: number;
  status: BroadcastStatus;
};

export const SEGMENT_EXPLANATION = "Segments are the different shows on Reactor TV. Each has its own characters and story, made up of short video chunks. This timer counts down to the next show. Open View Schedule to see what's coming up.";

function useNow(active: boolean): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [active]);

  return now;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  return `${String(minutes).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function promptState(prompt: ActivePrompt): string {
  if (prompt.playNow) return "Priority";
  if (prompt.status === "queued") return "Rendering";
  if (prompt.status === "playing") return "Playing now";
  return "Waiting";
}

function ExpandablePromptText({ id, text }: { id: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const expandable = text.length > 200;
  const visibleText = expandable && !expanded ? text.slice(0, 200).trimEnd() : text;

  return (
    <div
      className="schedule-prompt-copy"
      data-collapsed={(expandable && !expanded) || undefined}
      data-expanded={expanded || undefined}
      id={`${id}-body`}
    >
      <p>
        {visibleText}{expandable && !expanded ? "…" : ""}
        {expandable ? (
          <button
            aria-controls={`${id}-body`}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            {expanded ? "Show less" : "Read more"}
            <RiArrowDownSLine aria-hidden="true" />
          </button>
        ) : null}
      </p>
    </div>
  );
}

export function SegmentCountdown({ segment, startedAt, status }: SegmentCountdownProps) {
  const now = useNow(status === "live");
  if (status !== "live" || !segment) return null;
  const remaining = Math.max(0, segment.durationSeconds - (startedAt && now ? (now - startedAt) / 1000 : 0));
  return (
    <div className="segment-timer-info">
      <span className="timer-copy">
        {remaining === 0 ? <span>Next segment starting...</span> : <><span>Next segment in</span><strong>{clock(remaining)}</strong></>}
      </span>
      <InfoPopover title="What is a segment?" trigger={<RiQuestionLine aria-hidden="true" />} triggerClassName="timer-help">
        <p>{SEGMENT_EXPLANATION}</p>
      </InfoPopover>
    </div>
  );
}

export function ScheduleButton({ onClick, open, queuedPromptIds, prompts, notifyArrivals = true }: {
  onClick: () => void; open: boolean; queuedPromptIds?: readonly string[];
  prompts?: readonly SchedulePrompt[]; notifyArrivals?: boolean;
}) {
  const countId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const description = queuedPromptDescription(queuedPromptIds?.length);
  return (<>
    <button
      ref={buttonRef}
      aria-label={open ? "Close schedule" : "View Schedule"}
      aria-describedby={countId}
      aria-haspopup="dialog"
      aria-controls="broadcast-schedule"
      aria-expanded={open}
      className="segment-timer-button"
      data-open={open || undefined}
      onClick={onClick}
      title={description}
      type="button"
    >
      <RiCalendar2Line aria-hidden="true" /><span className="schedule-button-label">View Schedule</span>
      <ScheduleQueueCount promptIds={queuedPromptIds} />
    </button>
    <span id={countId} className="sr-only" role="status" aria-live="polite" aria-atomic="true">{description}</span>
    <ScheduleArrivalToast anchorRef={buttonRef} prompts={prompts} enabled={notifyArrivals && !open} onOpen={onClick} />
  </>);
}

export default function SchedulePanel({
  voting,
  segment,
  currentSegmentStartedAt,
  schedule,
  promptEstimates,
  currentAuthor,
  currentPrompt,
  onClose,
  open,
  prompts,
  status,
  usernameColor,
}: SchedulePanelProps) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = panel.current;
    drawer?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const mobile = window.matchMedia("(max-width: 820px), (max-width: 1024px) and (max-height: 500px)");
    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    const background = [...(drawer?.closest(".broadcast-shell")?.querySelectorAll<HTMLElement>(".topbar, .stream-controls, .player-media, .player-prompt, .chat-panel") ?? [])];
    const previousInert = background.map(element => element.inert);
    const applyMobileMode = () => {
      document.body.style.overflow = mobile.matches ? "hidden" : previousOverflow;
      document.documentElement.style.overflow = mobile.matches ? "hidden" : previousRootOverflow;
      drawer?.setAttribute("aria-modal", String(mobile.matches));
      background.forEach((element, index) => { element.inert = mobile.matches || previousInert[index]; });
    };
    applyMobileMode();
    mobile.addEventListener("change", applyMobileMode);
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !mobile.matches) return;
      const controls = drawer?.querySelectorAll<HTMLElement>("button, a[href], input, [tabindex='0']");
      if (!controls?.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    drawer?.addEventListener("keydown", trap);
    return () => {
      mobile.removeEventListener("change", applyMobileMode);
      background.forEach((element, index) => { element.inert = previousInert[index]; });
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      drawer?.removeEventListener("keydown", trap);
      trigger?.focus({ preventScroll: true });
    };
  }, [open]);
  const now = useNow(open);
  const currentIndex = schedule.findIndex(entry => entry._id === segment?.id);
  const upcoming = [...schedule.slice(currentIndex + 1), ...schedule.slice(0, currentIndex + 1)];
  const remaining = segment && currentSegmentStartedAt && now ? Math.max(0, segment.durationSeconds - (now - currentSegmentStartedAt) / 1000) : null;

  const futurePrompts = useMemo(
    () => orderedWaitingPrompts(prompts),
    [prompts],
  );
  const playingPrompt = prompts.find((prompt) => prompt.status === "playing");
  const displayedCurrentPrompt = currentPrompt ?? playingPrompt?.text;
  const displayedCurrentAuthor = currentAuthor ?? playingPrompt?.author;

  if (!open) return null;

  return (
    <aside ref={panel} role="dialog" aria-label="Broadcast schedule" className="schedule-panel" id="broadcast-schedule">
      <header className="schedule-panel-header">
        <div>
          <span className="system-label">Broadcast</span>
          <h2>Schedule</h2>
        </div>
        <button aria-label="Close broadcast schedule" onClick={onClose} type="button">
          <RiCloseLine aria-hidden="true" />
        </button>
      </header>

      <div className="schedule-scroll">
        <ol className="schedule-timeline">
          <li className="schedule-stop schedule-stop-current">
            <span className="schedule-node" aria-hidden="true" />
            <div className="schedule-kicker">
              <strong>{status === "live" ? "Now" : "Off air"}</strong>
              {status === "live" && remaining !== null ? <span>About {clock(remaining)} remaining</span> : null}
            </div>
            <section className="schedule-program">
              <div className="schedule-program-index">01</div>
              <div>
                <h3>{segment?.title ?? schedule[0]?.title ?? "No scheduled segments"}</h3>
                <p>{schedule.length ? "Scheduled in Admin. Playback repeats in order." : "Add an enabled segment in Admin > Schedule."}</p>
              </div>
            </section>
            <section aria-label="Prompts in this segment" className="schedule-segment-prompts">
              {voting?.enabled ? <div className="schedule-audience">
                <span className="system-label">Audience direction</span>
                {voting.round?.winnerIndex !== undefined ? <><strong>Next: {voting.round.options[voting.round.winnerIndex].label}</strong><p>Winner selected. This beat airs after buffered video, within {voting.round.segmentTitle}.</p></>
                  : <><strong>{voting.round?.status === "open" ? "The audience is choosing the next beat" : "Preparing the next vote"}</strong><p>{voting.round?.status === "open" ? `${voting.round.durationChunks - voting.round.completedChunks} chunk${voting.round.durationChunks - voting.round.completedChunks === 1 ? "" : "s"} left to vote.` : "Four options arrive with the next live beat."}</p></>}
                {voting.lastWinner?.winnerIndex !== undefined ? <small>On air: {voting.lastWinner.options[voting.lastWinner.winnerIndex].label}</small> : null}
              </div> : null}
              <div className="schedule-kicker">
                <strong>Prompts in this segment</strong>
                <span>{displayedCurrentPrompt ? "1 current, " : ""}{futurePrompts.length} {voting?.enabled ? "saved" : "queued"}</span>
              </div>
              {displayedCurrentPrompt ? (
                <div className="schedule-current-prompt">
                  <div className="schedule-prompt-row-header">
                    <div className="schedule-prompt-author">
                      {displayedCurrentAuthor ? <strong>{displayedCurrentAuthor}</strong> : null}
                      <b>/prompt</b>
                    </div>
                    <span>{status === "live" ? "On air" : "Current"}</span>
                  </div>
                  <ExpandablePromptText id="schedule-current-prompt" text={displayedCurrentPrompt} />
                </div>
              ) : null}
              {futurePrompts.length ? (
                <ol className="schedule-prompt-list">
                  {futurePrompts.map((prompt, index) => {
                    const estimate = promptEstimates.get(prompt._id);
                    return (
                      <li data-state={prompt.status} key={prompt._id}>
                        <div className="schedule-prompt-row-header">
                          <div>
                            <span className="schedule-prompt-order">{String(index + 1).padStart(2, "0")}</span>
                            <strong style={{ color: usernameColor(prompt.identity) }}>{prompt.author}</strong>
                            <b>/prompt</b>
                          </div>
                          <div className="schedule-prompt-meta">
                            <small title={estimate?.title}>{estimate?.label ?? promptState(prompt)}</small>
                          </div>
                        </div>
                        <ExpandablePromptText id={`schedule-prompt-${prompt._id}`} text={prompt.text} />
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="schedule-empty">No viewer prompts are waiting. New directions will appear here as soon as they are queued.</p>
              )}
            </section>
          </li>
          {upcoming.map((entry, index) => <li className="schedule-stop" key={entry._id}>
            <span className="schedule-node" aria-hidden="true" />
            <div className="schedule-kicker"><strong>{index === 0 ? "Next" : "Then"}</strong><span>{clock(entry.durationSeconds)}</span></div>
            <section className="schedule-program"><div className="schedule-program-index">{String(index + 2).padStart(2, "0")}</div><div><h3>{entry.title}</h3></div></section>
          </li>)}
        </ol>
      </div>
    </aside>
  );
}
