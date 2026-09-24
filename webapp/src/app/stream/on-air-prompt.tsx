"use client";

import { RiArrowDownSLine } from "@remixicon/react";
import { useState } from "react";
import { promptPreview, type OnAirPrompt as Prompt } from "@/lib/on-air-prompt";
import InfoPopover from "./info-popover";

export default function OnAirPrompt({ prompt }: { prompt: Prompt | null }) {
  const [reading, setReading] = useState<Prompt | null>(null);
  const expanded = reading ?? prompt;

  return <InfoPopover title="Current prompt" triggerClassName="on-air-prompt-trigger"
    onOpen={() => setReading(prompt)} onClose={() => setReading(null)}
    trigger={prompt ? <>
      <span className="on-air-prompt-label">Current prompt</span>
      <span className="on-air-prompt-quote">“<span className="on-air-prompt-preview">{promptPreview(prompt.text)}</span>”</span>
      <RiArrowDownSLine aria-hidden="true" />
    </> : null}>
    {expanded ? <>
      <span className="on-air-prompt-author">From <strong>{expanded.author}</strong></span>
      <p className="on-air-prompt-full">“{expanded.text}”</p>
    </> : null}
  </InfoPopover>;
}
