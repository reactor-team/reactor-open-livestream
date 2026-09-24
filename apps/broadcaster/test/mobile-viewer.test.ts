import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isFollowingChat, scrollChatToLatest } from "../../../webapp/src/lib/chat-scroll.js";

test("chat follows only near the bottom, including short lists and Safari overscroll", () => {
  assert.equal(isFollowingChat({scrollHeight: 1000, clientHeight: 400, scrollTop: 580}), true);
  assert.equal(isFollowingChat({scrollHeight: 1000, clientHeight: 400, scrollTop: 300}), false);
  assert.equal(isFollowingChat({scrollHeight: 400, clientHeight: 400, scrollTop: 0}), true);
  assert.equal(isFollowingChat({scrollHeight: 1000, clientHeight: 400, scrollTop: 620}), true);
});
test("following chat only mutates the rail's scroll position", () => {
  const rail = {scrollHeight: 900, clientHeight: 300, scrollTop: 0};
  scrollChatToLatest(rail);
  assert.equal(rail.scrollTop, 900);
  assert.doesNotThrow(() => scrollChatToLatest(null));
  const source = readFileSync("../../webapp/src/app/stream/broadcast-app.tsx", "utf8");
  assert.doesNotMatch(source, /scrollIntoView/);
  assert.ok(source.includes("if (!followChat.current) return"));
});
test("mobile viewer keeps media, controls and participation in document flow", () => {
  const css = readFileSync("../../webapp/src/app/stream/mobile.css", "utf8");
  assert.ok(css.includes("aspect-ratio: 16 / 9"));
  assert.match(css, /player-prompt[^}]*position: relative;[^}]*transform: none/);
  assert.match(css, /stream-controls[^}]*position: relative;[^}]*transform: none/);
  assert.match(css, /player-media video[^}]*object-fit: contain/);
  assert.match(css, /chat-compose input[^}]*font-size: 16px/);
});


test("responsive header and ballots preserve accessible controls in every state", async () => {
  const { build } = await import("esbuild");
  const { createRequire } = await import("node:module");
  const { resolve } = await import("node:path");
  const require = createRequire(resolve("../../webapp/package.json"));
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  async function component(file: string) {
    const bundled = await build({entryPoints: [resolve("../../webapp/src/app/stream",file)], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", alias: {"@": resolve("../../webapp/src")}});
    const module = {exports: {} as {default: unknown}};
    new Function("require", "module", "exports", bundled.outputFiles[0].text)(require,module,module.exports);
    return module.exports.default;
  }
  const Header = await component("broadcast-header.tsx");
  const header = renderToStaticMarkup(createElement(Header,{},createElement("button",{},"Copy with Codex")));
  assert.ok(header.includes('aria-expanded="false"'));
  assert.ok(header.includes('aria-controls="viewer-menu"'));
  assert.ok(header.includes('id="viewer-menu"'));
  assert.ok(header.includes("Copy with Codex"));
  const Vote = await component("vote-panel.tsx");
  const options = ["Jim passes the note", "Dwight checks the box", "Michael reads aloud", "Pam asks a question"].map((label,i)=>({label,votes:i}));
  const round = {_id:"r",status:"open",durationChunks:2,completedChunks:0,options};
  const render = (value: object,live=true) => renderToStaticMarkup(createElement(Vote,{voting:value,live,onVote:async()=>{}})) as string;
  const open = render({round,choice:1});
  assert.equal(open.split('class="vote-option"').length-1,4);
  assert.ok(open.includes('aria-pressed="true"'));
  assert.ok(open.includes('data-selected="true"'));
  assert.ok(open.includes('aria-label="3 votes"'));
  assert.ok(open.includes("2 chunks left"));
  assert.ok(open.includes('aria-describedby="vote-round-status"'));
  assert.ok(open.includes('class="sr-only"'));
  assert.equal(open.split("<button").length-1,4);
  assert.ok(!open.includes("<header") && !open.includes("<footer"));
  assert.ok(!open.includes("vote-outcome"));
  const withPreviousWinner = render({round,choice:1,lastWinner:{...round,winnerIndex:0}});
  assert.equal(withPreviousWinner.split("<button").length-1,4);
  const closed = render({round:{...round,status:"closed",winnerIndex:2},choice:1});
  assert.ok(closed.includes('data-winner="true"'));
  assert.equal(closed.split('disabled=""').length-1,4);
  const offline = render({round,choice:null},false);
  assert.equal(offline.split('disabled=""').length-1,4);
  assert.ok(offline.includes("Waiting for live playback"));
});
