"use client";

import { RiCheckLine, RiExternalLinkLine, RiOpenaiFill, RiTwitterXLine } from "@remixicon/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { captureStreamEvent } from "@/lib/analytics";

const REACTOR_EXAMPLE =
  "https://github.com/reactor-team/reactor-open-livestream";
const REACTOR_SITE = "https://reactor.inc";
const YC_APPLY = "https://www.ycombinator.com/apply";
const SPEEDRUN_APPLY = "https://speedrun.a16z.com/apply/form";

const SETUP_PROMPT = `Clone Reactor Open Livestream and act as its installation wizard:
${REACTOR_EXAMPLE}

Read the example README and repository instructions, install its dependencies, and run it locally. Use ${REACTOR_SITE} to learn how the Reactor platform works and how to configure access. Start by explaining the local setup and the first useful change you recommend.`;

type AgentName = "Codex" | "Claude";

function CopyAction({ agent, onCopied }: { agent: AgentName; onCopied: (agent: AgentName) => void }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(SETUP_PROMPT);
      captureStreamEvent("cta_clicked", { target: agent === "Codex" ? "codex" : "claude" });
      setState("copied");
      onCopied(agent);
    } catch {
      setState("failed");
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState("idle"), 1_800);
  }

  const isClaude = agent === "Claude";
  return (
    <button
      aria-label={`Copy Reactor setup prompt for ${agent}`}
      className={`partner-action ${isClaude ? "action-claude" : "action-codex"}`}
      onClick={() => void copy()}
      title={`Copy setup prompt for ${agent}`}
      type="button"
    >
      <span className="partner-action-mark">
        {state === "copied" ? (
          <RiCheckLine aria-hidden />
        ) : isClaude ? (
          <Image aria-hidden src="/brand/claude-code-clawd.svg" alt="" width={47} height={38} />
        ) : (
          <RiOpenaiFill aria-hidden />
        )}
      </span>
      <strong>{state === "copied" ? "Copied" : state === "failed" ? "Try again" : agent}</strong>
    </button>
  );
}

export default function PartnerActions() {
  const [toastAgent, setToastAgent] = useState<AgentName | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showCopiedToast(agent: AgentName) {
    setToastAgent(agent);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastAgent(null), 3_200);
  }

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  return (
    <>
      <section aria-label="Reactor links" className="partner-actions">
        <div className="partner-group community-group">
          <span className="partner-group-label">Find us on...</span>
          <div className="partner-group-actions">
            <a className="partner-action community-link" href="https://x.com/reactorworld"
              aria-label="Reactor on X (opens in a new tab)" title="@reactorworld on X"
              target="_blank" rel="noopener noreferrer">
              <RiTwitterXLine aria-hidden="true" /><span className="community-link-label">X</span>
            </a>
            <a className="partner-action community-link" href="/admin" aria-label="Open admin panel">
              <span>Admin</span>
            </a>
          </div>
        </div>
        <span className="partner-divider" aria-hidden />
        <div className="partner-group">
          <span className="partner-group-label">Copy with</span>
          <div className="partner-group-actions">
            <CopyAction agent="Codex" onCopied={showCopiedToast} />
            <CopyAction agent="Claude" onCopied={showCopiedToast} />
          </div>
        </div>
        <span className="partner-divider" aria-hidden />
        <div className="partner-group">
          <span className="partner-group-label">Apply to</span>
          <div className="partner-group-actions">
            <a
              aria-label="Apply to Y Combinator"
              className="partner-action action-yc"
              href={YC_APPLY}
              onClick={() => captureStreamEvent("cta_clicked", { target: "yc" })}
              rel="noreferrer"
              target="_blank"
            >
              <span aria-hidden className="yc-mark">Y</span>
              <strong>YC</strong>
              <RiExternalLinkLine aria-hidden className="partner-external-icon" />
            </a>
            <a
              aria-label="Apply to a16z Speedrun"
              className="partner-action action-speedrun"
              href={SPEEDRUN_APPLY}
              onClick={() => captureStreamEvent("cta_clicked", { target: "speedrun" })}
              rel="noreferrer"
              target="_blank"
            >
              <Image aria-hidden src="/brand/speedrun.svg" alt="" width={29} height={8} />
              <strong>Speedrun</strong>
              <RiExternalLinkLine aria-hidden className="partner-external-icon" />
            </a>
          </div>
        </div>
      </section>
      {toastAgent ? createPortal(
        <div aria-live="polite" className="copy-toast" role="status">
          <span><RiCheckLine aria-hidden /></span>
          <p><strong>Copied for {toastAgent}.</strong> Paste it into your agent to get started.</p>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
