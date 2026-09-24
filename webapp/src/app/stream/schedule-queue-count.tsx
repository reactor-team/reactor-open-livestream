"use client";

import { useEffect, useRef, useState } from "react";
import { animateQueueCount, hasQueueAddition, QUEUE_COUNT_DURATION_MS } from "@/lib/queue-count";

export default function ScheduleQueueCount({ promptIds }: { promptIds: readonly string[] | undefined }) {
  const count = promptIds?.length;
  const signature = promptIds === undefined ? undefined : JSON.stringify([...promptIds].sort());
  const [shown, setShown] = useState(count);
  const displayed = useRef(count);
  const previous = useRef<readonly string[] | undefined>(undefined);
  const badge = useRef<HTMLSpanElement>(null);
  const digits = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const ids: string[] | undefined = signature === undefined ? undefined : JSON.parse(signature);
    const initial = previous.current === undefined;
    const added = hasQueueAddition(previous.current, ids);
    previous.current = ids;
    if (ids === undefined) return;
    const target = ids.length;
    const start = displayed.current ?? target;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const show = (value: number) => { displayed.current = value; setShown(value); };
    const animations: Animation[] = [];
    const cancelCount = animateQueueCount(start, target, {
      now: () => performance.now(), requestFrame: callback => window.requestAnimationFrame(callback), cancelFrame: frame => window.cancelAnimationFrame(frame), show,
      immediate: initial || preference.matches || start === target,
    });
    if (!initial && !preference.matches) {
      if (start !== target && digits.current) animations.push(digits.current.animate([
        { transform: "translateY(" + (target > start ? "4px" : "-4px") + ")", opacity: 0.5 },
        { transform: "translateY(0)", opacity: 1 },
      ], { duration: QUEUE_COUNT_DURATION_MS, easing: "cubic-bezier(.16, 1, .3, 1)" }));
      if (added && badge.current) animations.push(badge.current.animate([
        { transform: "scale(1)" }, { transform: "scale(1.16)", offset: 0.35 }, { transform: "scale(1)" },
      ], { duration: 420, easing: "ease-out" }));
    }
    const finish = () => {
      if (!preference.matches) return;
      cancelCount(); animations.forEach(animation => animation.cancel()); show(target);
    };
    preference.addEventListener("change", finish);
    return () => {
      cancelCount(); animations.forEach(animation => animation.cancel());
      preference.removeEventListener("change", finish);
    };
  }, [signature]);

  return <span ref={badge} className="schedule-queue-count" aria-hidden="true" data-loading={count === undefined || undefined}>
    <span ref={digits}>{count === undefined ? "…" : shown ?? count}</span>
  </span>;
}
