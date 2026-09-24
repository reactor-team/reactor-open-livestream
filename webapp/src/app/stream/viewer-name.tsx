"use client";

import { isGenericViewerName, nameChangeWait, viewerNameError } from "@reactor/infinite-contracts";
import { ConvexError } from "convex/values";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { PromptNotice } from "./private-prompt-message";

export default function ViewerName({ name, canChangeAt = 0, legacyName, available, onSave }: {
  name: string | null | undefined;
  canChangeAt?: number;
  legacyName: string;
  available: boolean | undefined;
  onSave: (name: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(viewerNameError(legacyName) ? "" : legacyName);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [serverRetryAt, setServerRetryAt] = useState(0);
  const [notice, setNotice] = useState<{ id: string; title: string; reason: string } | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const retryAt = Math.max(canChangeAt, serverRetryAt);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function notifyCooldown(reason: string) {
    setNotice({ id: crypto.randomUUID(), title: "Name change unavailable", reason });
  }

  function showCooldown() {
    const reason = nameChangeWait(retryAt, Date.now());
    if (!reason) return false;
    notifyCooldown(reason);
    return true;
  }

  function closeEditor() {
    setEditing(false);
    setError("");
    changeButton.current?.focus();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !available || name === undefined) return;
    if (name && showCooldown()) { closeEditor(); return; }
    const invalid = viewerNameError(draft);
    if (invalid) { setError(invalid); return; }
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(draft.trim());
      setServerRetryAt(0);
      closeEditor();
    } catch (cause) {
      if (cause instanceof ConvexError && typeof cause.data === "object" && cause.data !== null
        && "code" in cause.data && cause.data.code === "NAME_CHANGE_COOLDOWN"
        && "canChangeAt" in cause.data && typeof cause.data.canChangeAt === "number") {
        setServerRetryAt(cause.data.canChangeAt);
        closeEditor();
        notifyCooldown(nameChangeWait(cause.data.canChangeAt, Date.now())
          ?? "Names can only be changed once an hour. Please wait before trying again.");
        return;
      }
      setError(cause instanceof ConvexError && typeof cause.data === "string"
        ? cause.data : "Could not save your name. Please try again.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  if (!available || name === undefined) return <p className="viewer-name-hint" role="status">
    {available === false ? "Name setup is waiting for the server update. Chat and prompts are paused." : "Loading your name..."}
  </p>;

  return <div className="viewer-name-control">
    {name ? <div className="viewer-name-saved">
      <span role="status">Chatting as <strong>{name}</strong></span>
      <button ref={changeButton} className="viewer-name-change" type="button" aria-label="Change your chat name"
        aria-expanded={editing} aria-controls="viewer-name-editor" onClick={() => {
          if (editing) closeEditor();
          else if (!showCooldown()) { setDraft(name); setError(""); dismissNotice(); setEditing(true); }
        }}>change?</button>
    </div> : null}
    {!name || editing ?
    <form id="viewer-name-editor" className="viewer-name-form" onSubmit={save} aria-label={name ? "Change your chat name" : "Choose your chat name"}
      onKeyDown={event => { if (event.key === "Escape" && name && !saving) closeEditor(); }}>
    <div className="viewer-name-heading">
      <label htmlFor="viewer-name">{name ? "Change your name" : "Choose your name"}</label>
      {name ? <button className="viewer-name-change" type="button" disabled={saving} onClick={closeEditor}>Cancel</button> : null}
    </div>
    <p className="viewer-name-hint" id="viewer-name-help">
      {!name ? (isGenericViewerName(legacyName) ? "Replace your generic name to chat or prompt. " : "Required to chat or prompt. ") : ""}
      You can change your name once an hour.
    </p>
    <div className="chat-compose">
      <input ref={inputRef} id="viewer-name" name="viewer-name" autoComplete="nickname" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        maxLength={24} placeholder="Your name" value={draft} disabled={saving}
        aria-invalid={Boolean(error)} aria-describedby={`viewer-name-help${error ? " viewer-name-error" : ""}`}
        onChange={event => { setDraft(event.target.value); setError(""); }} />
      <button type="submit" disabled={saving || !draft.trim() || draft.trim() === name} aria-busy={saving}>{saving ? "Saving..." : name ? "Save" : "Set name"}</button>
    </div>
    {error ? <p className="viewer-name-error" id="viewer-name-error" role="alert">{error}</p> : null}
    </form> : null}
    {notice ? <PromptNotice key={notice.id} notice={notice} onDismiss={dismissNotice} dismissLabel="Dismiss name change notification" /> : null}
  </div>;
}
