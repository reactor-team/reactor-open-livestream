"use client";

import { RiPauseLine, RiPlayLine } from "@remixicon/react";
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { announcementTickerLayout } from "@/lib/announcement-ticker";

export default function SiteBanner({ text }: { text: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const firstItem = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState<ReturnType<typeof announcementTickerLayout>>(null);
  const [paused, setPaused] = useState(false);

  useLayoutEffect(() => {
    let active = true;
    const measure = () => {
      if (!active || !viewport.current || !firstItem.current) return;
      const next = announcementTickerLayout(viewport.current.clientWidth, firstItem.current.getBoundingClientRect().width);
      setLayout(current => current?.copies === next?.copies && current?.distance === next?.distance ? current : next);
    };
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (firstItem.current) observer.observe(firstItem.current);
    measure();
    void document.fonts.ready.then(measure);
    return () => { active = false; observer.disconnect(); };
  }, [text]);

  if (!text.trim()) return null;
  return <div className="site-banner" data-ready={Boolean(layout) || undefined} data-paused={paused || undefined}>
    <span className="sr-only" role="status" aria-atomic="true">{text}</span>
    <div className="site-banner-viewport" ref={viewport} tabIndex={0} role="region" aria-label="Announcement" title={text}>
      <div className="site-banner-track" aria-hidden="true" style={layout ? {
        "--banner-distance": `${layout.distance}px`, "--banner-duration": `${layout.duration}s`,
      } as CSSProperties : undefined}>
        {Array.from({ length: layout?.copies ?? 1 }, (_, index) => <span className="site-banner-item" key={index} ref={index === 0 ? firstItem : undefined}>
          <span>{text}</span><i className="site-banner-separator" />
        </span>)}
      </div>
    </div>
    <button className="site-banner-toggle" type="button" aria-label={paused ? "Resume announcement" : "Pause announcement"}
      aria-pressed={paused} title={paused ? "Resume announcement" : "Pause announcement"} onClick={() => setPaused(value => !value)}>
      {paused ? <RiPlayLine aria-hidden="true" /> : <RiPauseLine aria-hidden="true" />}
    </button>
  </div>;
}
