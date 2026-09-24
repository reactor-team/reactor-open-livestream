"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { RiCloseLine } from "@remixicon/react";

/** Native top-layer detail shared by the header and player controls. */
export default function InfoPopover({ title, trigger, triggerClassName, children, onOpen, onClose }: {
  title: string; trigger: ReactNode; triggerClassName: string; children: ReactNode;
  onOpen?: () => void; onClose?: () => void;
}) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = () => panel.current?.hidePopover();
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, []);
  return <>
    {trigger !== null ? <button className={triggerClassName} type="button" popoverTarget={id} aria-haspopup="dialog" aria-label={title}
      onClick={event => {
        if (!panel.current) return;
        if (!panel.current.matches(":popover-open")) onOpen?.();
        const bounds = event.currentTarget.getBoundingClientRect();
        const width = Math.min(340, window.innerWidth - 32);
        panel.current.style.left = `${Math.max(16, Math.min(bounds.left, window.innerWidth - width - 16))}px`;
        panel.current.style.top = `${Math.max(16, bounds.bottom + 12)}px`;
      }}>{trigger}</button> : null}
    <section ref={panel} id={id} className="broadcast-info-popover" popover="auto" role="dialog" aria-labelledby={`${id}-title`}
      onToggle={event => {
        if (event.newState !== "open") { onClose?.(); return; }
        const bounds = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.top = `${Math.max(16, Math.min(bounds.top, window.innerHeight - bounds.height - 16))}px`;
      }}
      onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}>
      <header>
        <h2 id={`${id}-title`}>{title}</h2>
        <button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label="Close explanation" autoFocus><RiCloseLine aria-hidden="true" /></button>
      </header>
      {children}
    </section>
  </>;
}
