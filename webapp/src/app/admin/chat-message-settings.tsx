"use client";

import { CHAT_MESSAGE_TYPES, normalizeChatMessageTypes } from "@reactor/infinite-contracts";
import { useActionState, useState } from "react";
import { useBackend } from "../backend-context";
import { saveChatMessageSettings, type AdminActionState } from "./actions";

const initialState: AdminActionState = {};

export default function ChatMessageSettings({ enabledTypes }: { enabledTypes: readonly string[] }) {
  const backend = useBackend();
  const [selected, setSelected] = useState(() => normalizeChatMessageTypes(enabledTypes));
  const [state, action, pending] = useActionState(saveChatMessageSettings, initialState);
  return <form action={action} className="admin-settings-form admin-notice-form">
    <input type="hidden" name="backend" value={backend.target} />
    <section className="admin-section" aria-labelledby="chat-notices-title">
      <div className="admin-section-heading">
        <div><span className="system-label">Chat</span><h2 id="chat-notices-title">Reactor TV messages</h2></div>
        <p>Choose which automated notices everyone sees. Voting and viewer chat are unaffected.</p>
      </div>
      <fieldset className="admin-notice-fields" aria-label="Global message visibility" disabled={pending}>
        <div className="admin-notice-actions">
          <span>{selected.length} of {CHAT_MESSAGE_TYPES.length} types selected</span>
          <button type="button" onClick={() => setSelected(CHAT_MESSAGE_TYPES.map(type => type.id))}>Enable all</button>
          <button type="button" onClick={() => setSelected([])}>Disable all</button>
        </div>
        {CHAT_MESSAGE_TYPES.map(type => <label className="admin-notice-row" key={type.id}>
          <span><span>{type.label}</span><small>{type.description}</small></span>
          <input type="checkbox" name="enabledTypes" value={type.id} checked={selected.includes(type.id)}
            onChange={event => setSelected(current => event.target.checked ? [...current, type.id] : current.filter(id => id !== type.id))} />
        </label>)}
      </fieldset>
      <p className="admin-notice-help">All types, including future additions, default to off. Save to update existing and future chat messages for everyone immediately. History is kept.</p>
    </section>
    <footer className="admin-save-bar">
      <div aria-live="polite">
        {state.error ? <p className="admin-form-error">{state.error}</p> : null}
        {state.success ? <p className="admin-form-success">{state.success}</p> : null}
      </div>
      <button disabled={pending} type="submit">{pending ? "Saving" : "Save chat visibility"}</button>
    </footer>
  </form>;
}
