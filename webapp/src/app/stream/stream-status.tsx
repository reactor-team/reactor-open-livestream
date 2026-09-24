import { RiEyeLine } from "@remixicon/react";
import type { BroadcastStatus } from "@reactor/infinite-contracts";

const compactCount = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const exactCount = new Intl.NumberFormat("en-US");

export default function StreamStatus({ status, viewerCount }: { status: BroadcastStatus; viewerCount: number | undefined }) {
  const description = viewerCount === undefined
    ? "Loading current viewer count"
    : `${exactCount.format(viewerCount)} current viewer${viewerCount === 1 ? "" : "s"}`;
  return <div className="stream-status" data-live={status === "live" || undefined} role="status" aria-atomic="true">
    <span className="stream-status-label">
      <span className={`status-dot status-${status}`} aria-hidden="true" />
      <span>{status === "starting" ? "Connecting" : status}</span>
    </span>
    <span className="stream-viewers" title={description}>
      <RiEyeLine aria-hidden="true" />
      <span aria-hidden="true">{viewerCount === undefined ? "…" : compactCount.format(viewerCount)}</span>
      <span className="sr-only">{description}</span>
    </span>
  </div>;
}
