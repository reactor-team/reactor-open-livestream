"use client";

import { RiCloseLine, RiErrorWarningLine, RiLoader4Line, RiLockLine } from "@remixicon/react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { PrivatePromptEntry } from "@/lib/private-prompts";
import ChatTimestamp from "./chat-timestamp";
import ChatPromptText from "./chat-prompt-text";

export function PrivatePromptMessage({ entry, onEdit, onExpand }: { entry: PrivatePromptEntry; onEdit: (text: string) => void; onExpand?: () => void }) {
  const checking = entry.status === "checking";
  return <li className="chat-message chat-prompt chat-private-prompt" data-state={entry.status} role="status" aria-atomic="true">
    <span className="private-prompt-audience"><RiLockLine aria-hidden="true" />Only visible to you</span>
    <ChatTimestamp createdAt={entry.createdAt} />
    <strong>{entry.author}</strong>{" "}<span className="chat-message-body"><b>/prompt</b><ChatPromptText text={entry.body} onExpand={onExpand} /></span>
    <span className="private-prompt-status">
      {checking ? <RiLoader4Line className="private-prompt-spinner" aria-hidden="true" /> : <RiErrorWarningLine aria-hidden="true" />}
      {checking ? "Checking your prompt..." : entry.status === "rejected" ? "Not shared" : entry.status === "uncertain" ? "Not confirmed" : "Not submitted"}
    </span>
    {entry.reason ? <p className="private-prompt-reason">{entry.reason}</p> : null}
    {!checking ? <button className="private-prompt-edit" type="button" onClick={() => onEdit(entry.body)}>Edit prompt</button> : null}
  </li>;
}

export function PromptNotice({ notice, onDismiss, dismissLabel = "Dismiss prompt notification" }: {
  notice: { id: string; title: string; reason: string }; onDismiss: () => void; dismissLabel?: string;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(onDismiss, 12_000);
    return () => window.clearTimeout(timeout);
  }, [notice.id, onDismiss]);
  return createPortal(<div className="prompt-notice" role="alert">
    <RiErrorWarningLine aria-hidden="true" />
    <div><strong>{notice.title}</strong><p>{notice.reason}</p></div>
    <button type="button" aria-label={dismissLabel} onClick={onDismiss}><RiCloseLine aria-hidden="true" /></button>
  </div>, document.body);
}
