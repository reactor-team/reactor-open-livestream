"use client";

import { DEFAULT_FAKE_VIEWERS, MAX_FAKE_VIEWERS, type BroadcastSettings } from "@reactor/infinite-contracts";
import { useActionState } from "react";

import { useBackend } from "../backend-context";
import { saveSettings, type AdminActionState } from "./actions";

const initialState: AdminActionState = {};

export default function SettingsForm({
  settings,
}: {
  settings: BroadcastSettings;
}) {
  const backend = useBackend();
  const [state, action, pending] = useActionState(saveSettings, initialState);

  return (
    <form action={action} className="admin-settings-form">
      <input type="hidden" name="backend" value={backend.target} />
      <section className="admin-section admin-parameters">
        <div className="admin-section-heading">
          <div>
            <span className="system-label">Transmission</span>
            <h2>Broadcast parameters</h2>
          </div>
          <p>Update broadcast settings without restarting the stream.</p>
        </div>

        <div className="admin-field-row">
          <label htmlFor="chunk-seconds">
            <span>Default chunk length</span>
            <small>Used by segments without an override. FastH3 supports 6 to 14 seconds here.</small>
          </label>
          <div className="admin-number-control">
            <input
              defaultValue={settings.chunkSeconds}
              id="chunk-seconds"
              max="14"
              min="6"
              name="chunkSeconds"
              required
              step="1"
              type="number"
            />
            <span>SEC</span>
          </div>
        </div>

        <div className="admin-field-row">
          <label htmlFor="num-fake-viewers">
            <span>num_fake_viewers</span>
            <small>Added to the actual viewer count in the LIVE badge. Defaults to 50. Set to 0 to show only actual viewers. Saved changes appear immediately for everyone.</small>
          </label>
          <div className="admin-number-control">
            <input
              id="num-fake-viewers"
              name="num_fake_viewers"
              type="number"
              min="0"
              max={MAX_FAKE_VIEWERS}
              step="1"
              required
              defaultValue={settings.num_fake_viewers ?? DEFAULT_FAKE_VIEWERS}
            />
            <span>VIEWERS</span>
          </div>
        </div>

        <div className="admin-field-row admin-banner-field">
          <label htmlFor="interaction-mode">
            <span>Audience interaction</span>
            <small>Text prompts let viewers write their own next beat. Audience voting offers four short Cerebras-generated story directions. Chat stays available in both modes. Pending text prompts are preserved while voting is active.</small>
          </label>
          <select id="interaction-mode" name="interactionMode" defaultValue={settings.interactionMode}>
            <option value="prompts">Text prompts</option>
            <option value="voting">Audience voting</option>
          </select>
        </div>
        <div className="admin-field-row">
          <label htmlFor="vote-duration">
            <span>Vote duration</span>
            <small>Completed on-air chunks per round, not seconds. New rounds default to two. The winner enters the next unplanned beat; the next vote opens when that beat airs. Ties, including no votes, use the first tied option.</small>
          </label>
          <div className="admin-number-control">
            <input id="vote-duration" name="voteDurationChunks" type="number" min="1" max="12" step="1" required defaultValue={settings.voteDurationChunks} />
            <span>CHUNKS</span>
          </div>
        </div>
        <div className="admin-field-row admin-banner-field">
          <label htmlFor="site-banner">
            <span>Site banner</span>
            <small>Scrolls above the site header. Leave empty to hide it.</small>
          </label>
          <textarea
            defaultValue={settings.banner}
            id="site-banner"
            maxLength={240}
            name="banner"
            placeholder="Service notice, outage update, or transmission message"
            rows={3}
          />
        </div>
      </section>

      <footer className="admin-save-bar">
        <div aria-live="polite">
          {state.error ? <p className="admin-form-error">{state.error}</p> : null}
          {state.success ? <p className="admin-form-success">{state.success}</p> : null}
        </div>
        <button disabled={pending} type="submit">
          {pending ? "Saving" : "Save settings"}
        </button>
      </footer>
    </form>
  );
}
