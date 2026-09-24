"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { RiCloseLine, RiMenuLine } from "@remixicon/react";
import BroadcastLinks from "./broadcast-links";
import ReactorTvLockup from "@/components/reactor-tv-lockup";

export default function BroadcastHeader({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!header.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus({ preventScroll: true }); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <header className="topbar" ref={header}>
      <ReactorTvLockup className="brand-logo broadcast-brand-logo" />
      <BroadcastLinks className="broadcast-links-desktop" />
      <button ref={trigger} className="viewer-menu-toggle" type="button" aria-label={open ? "Close viewer menu" : "Open viewer menu"}
        aria-expanded={open} aria-controls="viewer-menu" onClick={() => setOpen(value => !value)}>
        {open ? <RiCloseLine aria-hidden="true" /> : <RiMenuLine aria-hidden="true" />}
      </button>
      <div className="header-actions" id="viewer-menu" data-open={open || undefined}
        onBlur={event => { if (event.relatedTarget && !header.current?.contains(event.relatedTarget as Node)) setOpen(false); }}>
        <BroadcastLinks className="broadcast-links-mobile" />
        {children}
      </div>
    </header>
  );
}
