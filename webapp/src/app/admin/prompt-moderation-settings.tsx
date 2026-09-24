"use client";

import { RiAddLine, RiCloseLine } from "@remixicon/react";
import { useActionState, useState } from "react";
import { BASE_PROMPT_RULES, MAX_PROMPT_CRITERIA, MAX_PROMPT_CRITERION_LENGTH, PROMPT_MODERATION_ALLOWANCES } from "../../../convex/lib/promptModerationPolicy";
import { useBackend } from "../backend-context";
import { savePromptModeration } from "./actions";

export default function PromptModerationSettings({ settings }: {
  settings: { criteria: string[]; revision: number } | null;
}) {
  const backend = useBackend();
  const [criteria, setCriteria] = useState(() => (settings?.criteria ?? []).map((text, id) => ({ id, text })));
  const [nextId, setNextId] = useState(criteria.length);
  const [dirty, setDirty] = useState(false);
  const [state, action, pending] = useActionState(savePromptModeration, { revision: settings?.revision ?? 0 });
  return <form action={action} className="admin-settings-form admin-moderation-form" onSubmit={() => setDirty(false)}>
    <input type="hidden" name="backend" value={backend.target} />
    <input type="hidden" name="revision" value={state.revision} />
    <section className="admin-section" aria-labelledby="prompt-moderation-title">
      <div className="admin-section-heading">
        <div><span className="system-label">User prompts</span><h2 id="prompt-moderation-title">Prompt moderation</h2></div>
        <p>Checked before a viewer prompt is shared in chat or sent to Cerebras. Ordinary chat, voting and admin-created segments are unaffected.</p>
      </div>
      <div className="admin-moderation-base">
        <h3>Built-in rules <span>Always on</span></h3>
        <dl>{BASE_PROMPT_RULES.map(rule => <div key={rule.category}><dt>{rule.title}</dt><dd>Reject {rule.criteria}.</dd></div>)}</dl>
        <details className="admin-moderation-allowances"><summary>Allowed by default</summary><p>{PROMPT_MODERATION_ALLOWANCES}</p><p>Additional criteria can narrow these allowances, but cannot weaken the built-in rules.</p></details>
      </div>
      <fieldset className="admin-moderation-fields" disabled={pending || !settings}>
        <legend>Additional criteria</legend>
        <p id="moderation-criteria-help">Describe what else to reject, one criterion per field. Up to {MAX_PROMPT_CRITERIA} criteria, {MAX_PROMPT_CRITERION_LENGTH} characters each. A matching criterion is shown to the viewer in their private rejection message, so use clear, public-safe wording.</p>
        {!settings ? <p className="admin-form-error" role="alert">Saved criteria could not be loaded. Editing is unavailable to protect the current rules. <a href="/admin">Reload moderation settings</a></p> : null}
        {!criteria.length && settings ? <p className="admin-moderation-empty">No additional criteria. Only the built-in rules apply.</p> : null}
        {criteria.map((criterion, index) => <div className="admin-moderation-criterion" key={criterion.id}>
          <label htmlFor={`prompt-criterion-${criterion.id}`}>Criterion {index + 1}</label>
          <textarea id={`prompt-criterion-${criterion.id}`} name="criteria" rows={2} required maxLength={MAX_PROMPT_CRITERION_LENGTH} value={criterion.text}
            aria-describedby="moderation-criteria-help" placeholder="For example: Reject prompts depicting animal cruelty."
            onChange={event => { setCriteria(current => current.map(row => row.id === criterion.id ? { ...row, text: event.target.value } : row)); setDirty(true); }} />
          <button type="button" aria-label={`Remove criterion ${index + 1}`} onClick={() => { setCriteria(current => current.filter(row => row.id !== criterion.id)); setDirty(true); }}><RiCloseLine aria-hidden="true" /></button>
        </div>)}
        <button className="admin-moderation-add" type="button" disabled={criteria.length >= MAX_PROMPT_CRITERIA} onClick={() => { setCriteria(current => [...current, { id: nextId, text: "" }]); setNextId(nextId + 1); setDirty(true); }}><RiAddLine aria-hidden="true" />Add criterion</button>
      </fieldset>
      <p className="admin-notice-help">Save to apply globally to new prompt submissions, with no deploy or stream restart. Removing extra criteria leaves every built-in rule enabled. Prompts already accepted are not rechecked.</p>
    </section>
    <footer className="admin-save-bar">
      <div aria-live="polite">
        {!dirty && state.error ? <p className="admin-form-error">{state.error}</p> : null}
        {!dirty && state.success ? <p className="admin-form-success">{state.success}</p> : null}
        {dirty ? <p>Unsaved changes</p> : null}
      </div>
      <button disabled={pending || !settings} type="submit">{pending ? "Saving" : "Save prompt moderation"}</button>
    </footer>
  </form>;
}
