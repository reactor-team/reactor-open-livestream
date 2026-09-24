import assert from "node:assert/strict";
import test from "node:test";
import { promptUnavailableReason } from "../../../webapp/src/lib/prompt-availability";

const ready = {
  connected: true, identity: "viewer-a", settingsLoaded: true, namesAvailable: true,
  viewerLoaded: true, name: "Riley", voting: false, checking: false, queueLoaded: true,
  acceptedOutstanding: false,
};

test("every blocked prompt state explains the reason and next action", () => {
  for (const [change, expected] of [
    [{ connected: false }, /Reconnecting.*draft is safe/],
    [{ identity: "" }, /viewer session.*loading/],
    [{ settingsLoaded: false }, /settings.*loading/],
    [{ namesAvailable: false }, /temporarily unavailable.*Refresh/],
    [{ viewerLoaded: false }, /profile.*loading/],
    [{ name: "" }, /Choose a name above the chat box/],
    [{ voting: true }, /Audience voting.*Choose an option/],
    [{ checking: true }, /being checked.*drafting/],
    [{ queueLoaded: false }, /queue.*loading.*draft is safe/],
    [{ ownPromptStatus: "playing" }, /playing.*draft now/],
    [{ ownPromptStatus: "pending", queueLabel: "#3 in queue" }, /#3 in queue.*One prompt at a time/],
    [{ ownPromptStatus: "queued", queueLabel: "#1 in queue" }, /#1 in queue.*One prompt at a time/],
    [{ acceptedOutstanding: true }, /accepted.*queue status/],
  ] as const) assert.match(promptUnavailableReason({ ...ready, ...change })!, expected);
  assert.equal(promptUnavailableReason(ready), null);
  assert.match(promptUnavailableReason({ ...ready, connected: false, checking: true })!, /Reconnecting/);
});

test("a live queue update changes feedback and releases the composer after playback", () => {
  const state = { ...ready, ownPromptStatus: "pending", queueLabel: "#2 in queue" };
  assert.match(promptUnavailableReason(state)!, /#2 in queue/);
  assert.match(promptUnavailableReason({ ...state, queueLabel: "#1 in queue" })!, /#1 in queue/);
  assert.match(promptUnavailableReason({ ...state, ownPromptStatus: "playing" })!, /playing/);
  assert.equal(promptUnavailableReason({ ...state, ownPromptStatus: undefined }), null);
});
