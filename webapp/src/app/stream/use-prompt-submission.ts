"use client";

import { useAction, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { PrivatePromptEntry } from "@/lib/private-prompts";
import type { Id } from "../../../convex/_generated/dataModel";
import { captureStreamEvent } from "@/lib/analytics";
import { blockedPromptCategory } from "@/lib/analytics-policy";

const failed = "We couldn't confirm your submission. Check the chat or queue before trying again.";

// Private feedback stays in this mounted tab, never in a shared Convex table.
export function usePromptSubmission() {
  const submit = useAction(api.prompts.submit);
  const inFlight = useRef(false);
  const [checking, setChecking] = useState(false);
  const [receipt, setReceipt] = useState<{ id: Id<"prompts">; identity: string } | null>(null);
  const acceptedDraft = useRef<PrivatePromptEntry | null>(null);
  const receiptStatus = useQuery(api.prompts.submissionStatus, receipt ? { ...receipt, includeBlocked: true } : "skip");
  // Undefined means the acknowledgement query has not caught up yet.
  const acceptedOutstanding = Boolean(receipt && receiptStatus !== "played" && receiptStatus !== "blocked" && receiptStatus !== null);
  const [entries, setEntries] = useState<PrivatePromptEntry[]>([]);
  const [notice, setNotice] = useState<{ id: string; title: string; reason: string } | null>(null);
  const showNotice = useCallback((title: string, reason: string) => {
    setNotice({ id: crypto.randomUUID(), title, reason });
  }, []);

  const showBlockedNotice = useCallback((reason: string) => {
    captureStreamEvent("prompt_blocked", { reason: blockedPromptCategory(reason) });
    setNotice({ id: crypto.randomUUID(), title: "Prompt not submitted", reason });
  }, []);

  useEffect(() => {
    if (receiptStatus !== "blocked" || !acceptedDraft.current) return;
    const draft = acceptedDraft.current;
    const reason = "Your prompt was removed by the final safety check and will not air. Please submit a different scene direction.";
    const timer = window.setTimeout(() => {
      acceptedDraft.current = null;
      setEntries(previous => [...previous.slice(-19), { ...draft, status: "rejected", reason }]);
      showNotice("Prompt removed", reason);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [receiptStatus, showNotice]);

  useEffect(() => {
    if (!checking) return;
    const timer = window.setTimeout(() => {
      setNotice({ id: crypto.randomUUID(), title: "Still checking your prompt",
        reason: "Confirmation is taking longer than expected. Your draft is safe. Check the chat or queue before trying again; your prompt may already have been accepted." });
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [checking]);

  async function submitPrompt(input: { text: string; author: string; identity: string }, source: "player" | "chat" = "player") {
    if (inFlight.current || acceptedOutstanding) {
      showBlockedNotice(inFlight.current
        ? "Your previous prompt is still being checked. You can keep drafting while you wait."
        : "Your previous prompt was accepted. Wait for it to finish before submitting another.");
      return false;
    }
    inFlight.current = true;
    const startedAt = performance.now();
    captureStreamEvent("prompt_submitted", { source });
    const id = crypto.randomUUID();
    setChecking(true);
    setNotice(null);
    setEntries(previous => [...previous.slice(-19), {
      _id: id, kind: "private-prompt", createdAt: Date.now(),
      body: input.text, author: input.author, status: "checking",
    }]);
    try {
      const result = await submit(input);
      captureStreamEvent("prompt_result", { source, outcome: result.status, duration_ms: Math.round(performance.now() - startedAt) });
      if (result.status === "accepted") {
        acceptedDraft.current = { _id: id, kind: "private-prompt", createdAt: Date.now(), body: input.text, author: input.author, status: "checking" };
        setReceipt({ id: result.promptId, identity: input.identity });
        setEntries(previous => previous.filter(entry => entry._id !== id));
        return true;
      }
      const status = result.status === "rejected" ? "rejected" : "failed";
      setEntries(previous => previous.map(entry => entry._id === id ? { ...entry, status, reason: result.reason } : entry));
      setNotice({ id, title: status === "rejected" ? "Prompt not shared" : "Prompt not submitted", reason: result.reason });
      return false;
    } catch {
      captureStreamEvent("prompt_result", { source, outcome: "uncertain", duration_ms: Math.round(performance.now() - startedAt) });
      // A lost action response can follow a successful write. Do not retry automatically.
      setEntries(previous => previous.map(entry => entry._id === id ? { ...entry, status: "uncertain", reason: failed } : entry));
      setNotice({ id, title: "Submission interrupted", reason: failed });
      return false;
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }

  const dismissNotice = useCallback(() => setNotice(null), []);
  return { checking, acceptedOutstanding, entries, notice, dismissNotice, showNotice, showBlockedNotice, submitPrompt };
}
