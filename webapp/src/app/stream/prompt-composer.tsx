"use client";

import { type FormEvent, type RefObject, useRef } from "react";

export default function PromptComposer({ value, onChange, onSubmit, onSetName, onBlocked, blockedReason, hasName, checking, inputRef }: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onSetName: () => void;
  onBlocked: (reason: string) => void;
  blockedReason: string | null;
  hasName: boolean;
  checking: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const explained = useRef<string | null>(null);
  function explainOnce() {
    if (blockedReason && explained.current !== blockedReason) onBlocked(blockedReason);
    explained.current = blockedReason;
  }
  return <>
    <form className="prompt-form" onSubmit={onSubmit}>
      <input ref={inputRef} className="prompt-input" maxLength={800} value={value}
        onFocus={explainOnce} onBlur={() => { explained.current = null; }}
        onChange={event => { onChange(event.target.value); explainOnce(); }}
        placeholder={!hasName ? "Choose a name in chat to prompt" : blockedReason ? "Draft your next prompt" : "Describe what should appear next"}
        aria-label="Prompt" aria-describedby={blockedReason ? "prompt-queue-status" : undefined} />
      {!hasName ? <button type="button" onClick={() => {
        if (blockedReason) onBlocked(blockedReason);
        onSetName();
      }}>Set name</button> : <button type="submit" aria-busy={checking}
        aria-describedby={blockedReason ? "prompt-queue-status" : undefined}>{checking ? "Checking..." : "Queue Prompt"}</button>}
    </form>
    <p className="sr-only" id="prompt-queue-status" role="status">{blockedReason}</p>
  </>;
}
