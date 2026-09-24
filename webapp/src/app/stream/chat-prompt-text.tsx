"use client";

import { useId, useState } from "react";
import { chatPromptPreview } from "@/lib/chat-prompt-preview";
import type { ChatMention } from "@reactor/infinite-contracts";
import { MentionText } from "./chat-social";

export default function ChatPromptText({ text, onExpand, mentions, identity }: { text: string; onExpand?: () => void; mentions?: readonly ChatMention[]; identity?: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const preview = chatPromptPreview(text);
  return <>
    <span id={id} className="chat-prompt-text" data-expanded={expanded || undefined}>
      <MentionText text={expanded ? text : preview.text} mentions={mentions} identity={identity} />
    </span>
    {preview.truncated ? <>{" "}<button
      type="button"
      className="chat-prompt-toggle"
      aria-expanded={expanded}
      aria-controls={id}
      onClick={() => {
        if (!expanded) onExpand?.();
        setExpanded(!expanded);
      }}
    >{expanded ? "See Less" : "See More"}</button></> : null}
  </>;
}
