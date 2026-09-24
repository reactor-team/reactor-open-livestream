"use client";

import { RiCheckLine } from "@remixicon/react";
import { VoteCount } from "./vote-panel";
import ChatTimestamp from "./chat-timestamp";

type ChannelEvent = { body: string; createdAt: number; systemKind?: string; vote: {
  status: string; segmentTitle: string; durationChunks: number; completedChunks: number; winnerIndex?: number;
  options: { label: string; votes: number }[];
} | null };

export default function ChannelMessage({ event }: { event: ChannelEvent }) {
  const round = event.vote;
  const remaining = Math.max(0, (round?.durationChunks ?? 0) - (round?.completedChunks ?? 0));
  const isOpen = event.systemKind === "vote-open";
  const live = isOpen && round?.status === "open";
  const isWinner = event.systemKind === "vote-winner";
  const isOutcome = isWinner || event.systemKind === "vote-playing";
  const total = round?.options.reduce((sum, option) => sum + option.votes, 0) ?? 0;

  return <li className="chat-message channel-message" data-kind={event.systemKind} title={round?.segmentTitle}>
    <p className="channel-message-line">
      <ChatTimestamp createdAt={event.createdAt} />
      <strong className="channel-message-sender">@reactorTV</strong>{" "}
      <span className="chat-message-body">
        {isOpen ? live ? "Vote now" : "Vote closed" : isOutcome ? <>
          <span className="channel-message-label">{isWinner ? "Winner: " : "On air: "}</span>
          <span className="channel-message-result">{event.body}</span>
        </> : event.body}
      </span>
      {live ? <small className="channel-message-meta"> · {remaining} chunk{remaining === 1 ? "" : "s"} left</small> : null}
      {isOutcome && round ? <small className="channel-message-meta"> · {total} vote{total === 1 ? "" : "s"}</small> : null}
    </p>
    {isOpen && round ? <ol className="channel-options" aria-label="Vote options">
      {round.options.map((option, index) => <li key={index} data-winner={round.winnerIndex === index || undefined}>
        <span className="channel-option-letter">{String.fromCharCode(65 + index)}</span>
        <span className="channel-option-body">{option.label}{" "}
          <span className="channel-option-count">(<VoteCount value={option.votes} />)</span>
          {round.winnerIndex === index ? <RiCheckLine className="channel-option-winner" role="img" aria-label="Winner" /> : null}
        </span>
      </li>)}
    </ol> : null}
  </li>;
}
