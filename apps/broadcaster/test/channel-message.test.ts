import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";
import { mergeVoteOutcomes } from "../../../webapp/src/lib/chat-messages";

test("Reactor TV updates render inline as chat with readable counts and no card chrome", async () => {
  const bundled = await build({
    entryPoints: ["../../webapp/src/app/stream/channel-message.tsx"],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    alias: { "@": resolve("../../webapp/src") }, loader: { ".css": "empty" },
  });
  const require = createRequire(resolve("../../webapp/package.json"));
  const module = { exports: {} as { default: unknown } };
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, module, module.exports);
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const render = (event: Record<string, unknown>): string => renderToStaticMarkup(createElement(module.exports.default, { event }));
  const options = ["Open the box", "Pass it to Jim", "Hide the note", "Ask Dwight"].map((label, index) => ({ label, votes: index }));
  const vote = { status: "open", segmentTitle: "The Office", durationChunks: 2, completedChunks: 1, options };
  const open = render({ systemKind: "vote-open", body: "Choose what happens next", vote });
  assert.match(open, /class="chat-message channel-message"/);
  assert.match(open, /<strong class="channel-message-sender">@reactorTV<\/strong>/);
  assert.doesNotMatch(open, /<svg[^>]*channel-message-sender/);
  assert.match(open, /Vote now/);
  assert.match(open, /1 chunk left/);
  assert.match(open, /title="The Office"/);
  assert.equal((open.match(/class="channel-option-letter"/g) ?? []).length, 4);
  assert.match(open, /aria-label="3 votes"/);
  assert.doesNotMatch(open, /<(?:header|footer)\b/);
  const closed = render({ systemKind: "vote-open", body: "Choose what happens next", vote: { ...vote, status: "closed", winnerIndex: 3 } });
  assert.match(closed, /Vote closed/);
  assert.match(closed, /aria-label="Winner"/);
  assert.doesNotMatch(closed, /chunks? left/);
  const winner = render({ systemKind: "vote-winner", body: "Ask Dwight", vote });
  assert.match(winner, /Winner:/);
  assert.match(winner, /Ask Dwight/);
  assert.match(winner, /6 votes/);
  assert.doesNotMatch(winner, /<ol\b|<(?:header|footer)\b/);
  const playing = render({ systemKind: "vote-playing", body: "Ask Dwight", vote });
  assert.match(playing, /On air:/);
  assert.match(playing, /6 votes/);
  const cancelled = render({ systemKind: "vote-cancelled", body: "Segment ended", vote });
  assert.match(cancelled, /Segment ended/);
  assert.doesNotMatch(cancelled, /On air:|Winner:/);
  assert.match(render({ systemKind: "future-notice", body: "A future notice", vote: null }), /A future notice/);
});

test("winner becomes on air in one stable row without removing intervening viewer chat", () => {
  const winner = { _id: "winner-1", kind: "system", systemKind: "vote-winner", roundId: "round-1", body: "Open the box" };
  const viewer = { _id: "viewer-1", kind: "message", body: "Nice" };
  const playing = { ...winner, _id: "playing-1", systemKind: "vote-playing" };
  const before = mergeVoteOutcomes([winner, viewer]);
  assert.deepEqual(before, [winner, viewer]);
  const after = mergeVoteOutcomes([winner, viewer, playing]);
  assert.deepEqual(after, [{ ...playing, _id: winner._id }, viewer]);
  assert.equal(before[0]._id, after[0]._id);
  assert.equal(winner.systemKind, "vote-winner");
});

test("outcome merging uses protected round identity, not matching body text or author names", () => {
  const rows = [
    { _id: "open", kind: "system", systemKind: "vote-open", roundId: "one", body: "Choose" },
    { _id: "winner-one", kind: "system", systemKind: "vote-winner", roundId: "one", body: "Open the box" },
    { _id: "viewer", kind: "message", systemKind: "vote-playing", roundId: "one", body: "Open the box" },
    { _id: "winner-two", kind: "system", systemKind: "vote-winner", roundId: "two", body: "Open the box" },
    { _id: "playing-one", kind: "system", systemKind: "vote-playing", roundId: "one", body: "Open the box" },
    { _id: "unlinked", kind: "system", systemKind: "vote-playing", body: "Open the box" },
  ];
  const result = mergeVoteOutcomes(rows);
  assert.deepEqual(result.map(row => row._id), ["open", "winner-one", "viewer", "winner-two", "unlinked"]);
  assert.equal(result[1].systemKind, "vote-playing");
  assert.equal(result[3].systemKind, "vote-winner");
});

test("partial chat history retains standalone on-air outcomes and never regresses their state", () => {
  const playing = { _id: "playing", kind: "system", systemKind: "vote-playing", roundId: "one" };
  const winner = { ...playing, _id: "winner", systemKind: "vote-winner" };
  assert.deepEqual(mergeVoteOutcomes([playing]), [playing]);
  assert.deepEqual(mergeVoteOutcomes([playing, winner, playing]), [playing]);
});
