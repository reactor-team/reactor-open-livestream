"use client";

import { RiArrowRightUpLine } from "@remixicon/react";
import InfoPopover from "./info-popover";
import { captureStreamEvent } from "@/lib/analytics";

export const H3_PLAYGROUND_URL = "https://www.reactor.inc/models/fast-h3";
export const BROADCAST_EXPLANATION = "Reactor TV is a continuous AI-generated broadcast powered by FastH3 on Reactor. The model creates video and audio in short chunks, each continuing from the last. Scheduled segments set the scene. Your votes, or text prompts when enabled, shape what happens next. Everyone watches the same stream as the story unfolds.";

export default function BroadcastLinks({ className = "" }: { className?: string }) {
  return <div className={`broadcast-links ${className}`}>
    <a className="h3-link" href={H3_PLAYGROUND_URL} target="_blank" rel="noopener noreferrer" onClick={() => captureStreamEvent("cta_clicked", { target: "fasth3" })}>
      Try FastH3 on Reactor<RiArrowRightUpLine aria-hidden="true" />
    </a>
    <InfoPopover title="How does this work?" trigger="How does this work?" triggerClassName="broadcast-info-trigger">
      <p>{BROADCAST_EXPLANATION}</p>
      <a href={H3_PLAYGROUND_URL} target="_blank" rel="noopener noreferrer" onClick={() => captureStreamEvent("cta_clicked", { target: "learn_more" })}><span>Learn more about FastH3 on Reactor</span><RiArrowRightUpLine aria-hidden="true" /></a>
    </InfoPopover>
  </div>;
}
