"use client";

import { useMemo, useSyncExternalStore } from "react";
import { formatChatTimestamp } from "@/lib/chat-timestamp";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export default function ChatTimestamp({ createdAt }: { createdAt: number }) {
  // The server's timezone must never appear as the viewer's local time.
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const timestamp = useMemo(() => hydrated ? formatChatTimestamp(createdAt) : null, [createdAt, hydrated]);
  if (!timestamp) return null;

  return <time className="chat-timestamp" dateTime={timestamp.dateTime}
    title={timestamp.fullLabel} aria-label={timestamp.fullLabel}>{timestamp.label}</time>;
}
