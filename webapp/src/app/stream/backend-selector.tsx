"use client";
import { useState } from "react";
import { BACKEND_CHANGE, useBackend } from "../backend-context";

export default function BackendSelector() {
  const backend = useBackend();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!backend.switchable) return null;
  async function select(target: "local" | "staging") {
    if (target === backend.target) return;
    const warning = target === "staging" ? "Connect to staging? Votes, prompts and saved Admin edits will affect the remote broadcast." : "Connect to your local backend?";
    if (!window.confirm(warning + " This reloads your local tabs. Save any unfinished edits first. Neither broadcaster will be started or stopped.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/dev/backend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not change backend");
      try { window.localStorage.setItem(BACKEND_CHANGE, String(Date.now())); } catch { /* Cookie selection does not require browser storage. */ }
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not change backend"); setBusy(false); }
  }
  return <section className="backend-selector" aria-label="Backend connection">
    <label>Backend</label>
    <div role="group" aria-label="Select backend">
      <button type="button" aria-pressed={backend.target === "local"} disabled={busy} onClick={() => void select("local")}>Local</button>
      <button type="button" aria-pressed={backend.target === "staging"} disabled={busy || !backend.stagingAvailable} onClick={() => void select("staging")}>Remote / Staging</button>
    </div>
    <p>{busy ? "Reconnecting..." : backend.target === "staging" ? "Using the deployed broadcast, chat, votes and schedule. Saved Admin edits affect staging." : "Using your local Convex database and broadcaster."}</p>
    <code>{backend.convexUrl}</code>
    {!backend.stagingAvailable ? <p>Set DEV_REMOTE_CONVEX_URL and DEV_REMOTE_SITE_URL in the local server environment to enable staging.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
