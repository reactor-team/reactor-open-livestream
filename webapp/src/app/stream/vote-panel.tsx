"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { RiCheckLine } from "@remixicon/react";
import type { PublicVoting } from "@reactor/infinite-contracts";

export function VoteCount({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    const start = previous.current;
    previous.current = value;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = reduced ? 1 : Math.min(1, (now - began) / 260);
      setShown(Math.round(start + (value - start) * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span className="vote-count" aria-label={`${value} votes`}><span aria-hidden="true">{shown}</span></span>;
}

export default function VotePanel({ voting, live, onVote }: {
  voting: PublicVoting | undefined; live: boolean;
  onVote: (roundId: string, option: number) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const round = voting?.round;
  const open = round?.status === "open";
  const remaining = Math.max(0, (round?.durationChunks ?? 0) - (round?.completedChunks ?? 0));
  const total = round?.options.reduce((sum, option) => sum + option.votes, 0) ?? 0;
  const winner = round?.winnerIndex !== undefined ? round.options[round.winnerIndex] : null;
  async function vote(index: number) {
    if (!round) return;
    setPending(true); setError("");
    try { await onVote(round._id, index); }
    catch { setError("Vote not recorded. Try again while this round is open."); }
    finally { setPending(false); }
  }
  return <section className="audience-vote" aria-label="Audience voting" aria-describedby="vote-round-status">
    <span className="sr-only" id="vote-round-status" role="status">
      {!live ? "Waiting for live playback" : open && round ? `Voting open. ${remaining} chunk${remaining === 1 ? "" : "s"} left` : winner ? "Winner queued" : "Preparing choices"}
    </span>
    {round ? <div className="vote-options">
      {round.options.map((option, index) => <button
        key={`${round._id}:${index}`} type="button" className="vote-option"
        aria-pressed={voting?.choice === index} aria-label={`${String.fromCharCode(65 + index)}. ${option.label}. ${option.votes} votes${round.winnerIndex === index ? ". Winner" : ""}`}
        disabled={!open || !live || pending} onClick={() => void vote(index)}
        data-selected={voting?.choice === index || undefined} data-winner={round.winnerIndex === index || undefined}
        style={{ "--vote-share": `${total ? option.votes / total * 100 : 0}%` } as CSSProperties}
      >
        <span className="vote-letter">{voting?.choice === index || round.winnerIndex === index ? <RiCheckLine aria-hidden="true" /> : String.fromCharCode(65 + index)}</span>
        <span className="vote-option-label">{option.label}</span>
        <VoteCount value={option.votes} />
        <span className="vote-share" aria-hidden="true" />
      </button>)}
    </div> : <p className="vote-preparing">Four story directions will appear with the next live beat.</p>}

    {error ? <p className="vote-error" role="alert">{error}</p> : null}
  </section>;
}
