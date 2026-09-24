"use client";

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { promptPreview } from "@/lib/on-air-prompt";
import {
  batchScheduleNotice, ScheduleArrivals, scheduleNoticeFlight, scheduleNoticePosition,
  SCHEDULE_NOTICE_FLIGHT_MS, SCHEDULE_NOTICE_HOLD_MS, SCHEDULE_NOTICE_PULSE_MS,
  type ScheduleNotice, type SchedulePrompt,
} from "@/lib/schedule-arrival";

export default function ScheduleArrivalToast({ anchorRef, prompts, enabled, onOpen }: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  prompts?: readonly SchedulePrompt[];
  enabled: boolean;
  onOpen: () => void;
}) {
  const tracker = useRef(new ScheduleArrivals());
  const pending = useRef<ScheduleNotice | null>(null);
  const active = useRef<ScheduleNotice | null>(null);
  const [notice, setNotice] = useState<ScheduleNotice | null>(null);
  const advance = useCallback(() => {
    active.current = pending.current;
    pending.current = null;
    setNotice(active.current);
  }, []);
  const dismiss = useCallback(() => {
    pending.current = null;
    active.current = null;
    setNotice(null);
  }, []);

  useEffect(() => {
    const arrivals = tracker.current.observe(prompts, enabled && !document.hidden);
    // The Convex snapshot is an external admission event, not derived display state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!enabled || document.hidden) dismiss();
    else if (arrivals.length) {
      pending.current = batchScheduleNotice(pending.current, arrivals);
      if (!active.current) advance();
    }
    const visibility = () => {
      tracker.current.observe(prompts, false);
      dismiss();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [prompts, enabled, advance, dismiss]);

  const excerpt = notice ? promptPreview(notice.text) : "";
  const title = notice && notice.count > 1 ? `${notice.count} prompts added to View Schedule` : "Added to View Schedule";
  return <>
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {notice ? `${title}: ${excerpt}` : ""}
    </span>
    {notice && enabled ? <ArrivalCard key={notice.id} anchorRef={anchorRef} onDone={advance} onDismiss={dismiss} onOpen={onOpen} excerpt={excerpt} /> : null}
  </>;
}

function ArrivalCard({ anchorRef, onDone, onDismiss, onOpen, excerpt }: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  onDone: () => void;
  onDismiss: () => void;
  onOpen: () => void;
  excerpt: string;
}) {
  const cardRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const card = cardRef.current;
    const anchor = anchorRef.current;
    if (!card || !anchor) return;
    const controls = anchor.closest(".stream-controls");
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const animations: Animation[] = [];
    let timer: number | undefined;
    let phase: "reading" | "flying" | "done" = "reading";
    let hovering = false;
    let focused = false;
    let disposed = false;
    const finish = () => { if (!disposed && phase !== "done") { phase = "done"; onDone(); } };
    const clearTimer = () => window.clearTimeout(timer);
    const position = () => {
      if (phase !== "reading") { finish(); return; }
      const rect = anchor.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) { finish(); return; }
      const point = scheduleNoticePosition(rect, controls?.getBoundingClientRect().bottom ?? rect.bottom,
        { width: card.offsetWidth, height: card.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
      card.style.left = `${point.left}px`;
      card.style.top = `${point.top}px`;
      card.style.visibility = "visible";
    };
    const fly = () => {
      if (preference.matches || !card.animate || !anchor.animate) { finish(); return; }
      phase = "flying";
      card.dataset.flying = "true";
      card.inert = true;
      const from = card.getBoundingClientRect();
      const to = anchor.getBoundingClientRect();
      const x = to.left + to.width / 2 - from.left - from.width / 2;
      const y = to.top + to.height / 2 - from.top - from.height / 2;
      const flight = card.animate(scheduleNoticeFlight(x, y), {
        duration: SCHEDULE_NOTICE_FLIGHT_MS, easing: "cubic-bezier(.45, 0, .8, .3)", fill: "forwards",
      });
      animations.push(flight);
      flight.onfinish = () => {
        if (disposed || preference.matches) { finish(); return; }
        const pulse = anchor.animate([
          { boxShadow: "0 0 0 0 color-mix(in srgb, var(--dune) 35%, transparent)" },
          { boxShadow: "0 0 0 4px transparent" },
        ], { duration: SCHEDULE_NOTICE_PULSE_MS, easing: "ease-out" });
        animations.push(pulse);
        pulse.onfinish = finish;
      };
    };
    const arm = () => {
      clearTimer();
      if (phase === "reading" && !hovering && !focused) timer = window.setTimeout(fly, SCHEDULE_NOTICE_HOLD_MS);
    };
    const enter = () => { hovering = true; clearTimer(); };
    const leave = () => { hovering = false; arm(); };
    const focus = () => { focused = true; clearTimer(); };
    const blur = () => { focused = false; arm(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.activeElement === card) anchor.focus({ preventScroll: true });
      onDismiss();
    };
    const reduceMotion = () => {
      if (!preference.matches) return;
      animations.forEach(animation => animation.cancel());
      if (phase === "flying") finish();
    };
    position();
    if (!preference.matches && card.animate) {
      animations.push(card.animate([
        { opacity: 0, transform: "translate(-6px, 4px) scale(.97)" },
        { opacity: 1, transform: "translate(0, 0) scale(1)" },
      ], { duration: 140, easing: "ease-out" }));
    }
    arm();
    const resize = new ResizeObserver(position);
    resize.observe(anchor);
    if (controls) resize.observe(controls);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.addEventListener("keydown", escape);
    preference.addEventListener("change", reduceMotion);
    card.addEventListener("pointerenter", enter);
    card.addEventListener("pointerleave", leave);
    card.addEventListener("focus", focus);
    card.addEventListener("blur", blur);
    return () => {
      disposed = true;
      clearTimer();
      animations.forEach(animation => animation.cancel());
      resize.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("keydown", escape);
      preference.removeEventListener("change", reduceMotion);
      card.removeEventListener("pointerenter", enter);
      card.removeEventListener("pointerleave", leave);
      card.removeEventListener("focus", focus);
      card.removeEventListener("blur", blur);
    };
  }, [anchorRef, onDone, onDismiss]);

  return createPortal(<button ref={cardRef} className="schedule-arrival-toast" type="button" aria-label={`View scheduled prompt: ${excerpt}`} onClick={() => {
    anchorRef.current?.focus({ preventScroll: true });
    onDismiss();
    onOpen();
  }}>
    <span className="schedule-arrival-excerpt">{excerpt}</span>
  </button>, document.body);
}
