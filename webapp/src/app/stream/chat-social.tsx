"use client";

import { mentionTokens, reactionDetails, type ChatMention, type ReactionKey } from "@reactor/infinite-contracts";
import { RiEmotionLine, RiHeartFill, RiHeartLine, RiStarLine } from "@remixicon/react";
import { Component, lazy, Suspense, type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { emojiPopoverPosition, rememberEmoji } from "@/lib/recent-emojis";

const EmojiPicker = lazy(() => import("./emoji-picker"));

export function ChatMessageMeta({ timing, status, children }: {
  timing?: { label: string; title?: string } | null;
  status?: string;
  children?: ReactNode;
}) {
  if (!timing && !children) return null;
  return <span className="chat-message-meta">
    {timing ? <small className="chat-prompt-status" data-tone={status} title={timing.title}>{timing.label}</small> : null}
    {children}
  </span>;
}

export function UserStars({ count }: { count: number }) {
  if (!count) return null;
  return <span className="chat-user-stars" aria-label={`${count} stars`}><RiStarLine aria-hidden="true" /><span>{count}</span></span>;
}

export function MentionText({ text, mentions = [], identity }: { text: string; mentions?: readonly ChatMention[]; identity?: string }) {
  const parts = [];
  let offset = 0;
  for (const token of mentionTokens(text)) {
    const recipients = mentions.filter(mention => mention.name.toLowerCase() === token.name.toLowerCase());
    if (!recipients.length) continue;
    parts.push(text.slice(offset, token.start));
    parts.push(<span key={token.start} className="chat-mention" data-self={recipients.some(item => item.identity === identity) || undefined}>{text.slice(token.start, token.end)}</span>);
    offset = token.end;
  }
  parts.push(text.slice(offset));
  return <>{parts}</>;
}

export default function ChatReactions({ counts = {}, selected = [], onReact, onOpen, onError }: {
  counts?: Record<string, number>; selected?: readonly string[];
  onReact: (key: ReactionKey, active: boolean) => Promise<unknown>;
  onOpen?: () => void; onError: (cause: unknown) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  async function react(key: ReactionKey) {
    if (inFlight.current.has(key)) return;
    setOpen(false);
    inFlight.current.add(key);
    setPending([...inFlight.current]);
    try {
      const active = !selected.includes(key);
      await onReact(key, active);
      if (active) rememberEmoji(key);
    }
    catch (cause) { onError(cause); }
    finally { inFlight.current.delete(key); setPending([...inFlight.current]); }
  }

  return <span className="chat-reactions">
    <button type="button" className="chat-reaction chat-like" data-empty={!counts.like || undefined} aria-label={`${selected.includes("like") ? "Unlike" : "Like"} message${counts.like ? `, ${counts.like} ${counts.like === 1 ? "like" : "likes"}` : ""}`}
      aria-pressed={selected.includes("like")} aria-busy={pending.includes("like")} onClick={() => void react("like")}>
      {selected.includes("like") ? <RiHeartFill aria-hidden="true" /> : <RiHeartLine aria-hidden="true" />}
      {counts.like ? <span>{counts.like}</span> : null}
    </button>
    {Object.keys(counts).map(reactionDetails).filter(item => item && counts[item.key] > 0).map(item => item ? <button key={item.key} type="button" className="chat-reaction chat-emoji-reaction"
      aria-label={`${item.label}, ${counts[item.key]} ${counts[item.key] === 1 ? "reaction" : "reactions"}`} aria-pressed={selected.includes(item.key)} aria-busy={pending.includes(item.key)}
      onClick={() => void react(item.key)}><span aria-hidden="true">{item.emoji}</span><span>{counts[item.key]}</span></button> : null)}
    <button ref={trigger} type="button" className="chat-reaction chat-add-reaction" aria-label="Add reaction" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => { if (!open) onOpen?.(); setOpen(value => !value); }}><RiEmotionLine aria-hidden="true" /></button>
    {open ? <ReactionPopover trigger={trigger} onClose={() => setOpen(false)}>
      <PickerErrorBoundary><Suspense fallback={<span className="emoji-picker-empty" role="status">Loading emojis...</span>}>
        <EmojiPicker selected={selected} onSelect={key => { trigger.current?.focus({ preventScroll: true }); void react(key); }} onClose={() => { trigger.current?.focus({ preventScroll: true }); setOpen(false); }} />
      </Suspense></PickerErrorBoundary>
    </ReactionPopover> : null}
  </span>;
}

class PickerErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <span className="emoji-picker-empty" role="alert">Couldn&apos;t load emojis. Refresh and try again.</span> : this.props.children; }
}

function ReactionPopover({ trigger, onClose, children }: { trigger: RefObject<HTMLButtonElement | null>; onClose: () => void; children: ReactNode }) {
  const picker = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; });
  useLayoutEffect(() => {
    const panel = picker.current;
    const anchor = trigger.current;
    if (!panel || !anchor) return;
    const visual = window.visualViewport;
    const position = () => {
      const bounds = anchor.getBoundingClientRect();
      const view = { width: visual?.width ?? innerWidth, height: visual?.height ?? innerHeight, left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0 };
      panel.style.width = `${Math.min(352, view.width - 16)}px`;
      panel.style.height = `${Math.min(420, view.height - 16)}px`;
      const point = emojiPopoverPosition(bounds, { width: panel.offsetWidth, height: panel.offsetHeight }, view);
      panel.style.left = `${point.left}px`;
      panel.style.top = `${point.top}px`;
    };
    panel.showPopover();
    position();
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.contains(event.target)) panel.hidePopover(); };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", scroll, true);
    visual?.addEventListener("resize", position);
    visual?.addEventListener("scroll", position);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", scroll, true);
      visual?.removeEventListener("resize", position);
      visual?.removeEventListener("scroll", position);
    };
  }, [trigger]);
  return createPortal(<div ref={picker} popover="auto" className="chat-reaction-picker" role="dialog" aria-label="Choose a reaction"
    onToggle={event => { if (event.newState === "closed") closeRef.current(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); trigger.current?.focus({ preventScroll: true }); closeRef.current(); } }}>
    {children}
  </div>, document.body);
}
