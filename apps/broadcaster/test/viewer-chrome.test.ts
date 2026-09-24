import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import ts from "typescript";
import {staticTile, STATIC_FADE_MS, STATIC_FRAME_MS, STATIC_TILE_SIZE} from "../../../webapp/src/lib/signal-noise";

const source = (path: string) => readFileSync(resolve("../../webapp/src", path), "utf8");
function syntax(path: string) { return ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function className(node: ts.Node): string | undefined {
  const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined;
  const attribute = opening?.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText() === "className");
  return attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : undefined;
}
test("sound unlock belongs inside the player and cannot become a page-wide input shield", () => {
  let gate: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (className(node) === "sound-gate") gate = node; ts.forEachChild(node, visit); };
  visit(syntax("app/stream/broadcast-app.tsx"));
  assert.ok(gate);
  let parent: ts.Node | undefined = gate.parent;
  while (parent && !className(parent)) parent = parent.parent;
  assert.equal(parent && className(parent), "player-media");
  const styles = source("app/globals.css");
  const gateRule = /\.sound-gate\s*\{([^}]+)\}/.exec(styles)?.[1] ?? "";
  assert.match(gateRule, /position: absolute/); assert.doesNotMatch(gateRule, /fixed/);
  assert.match(styles, /\.chat-panel > header\s*\{[^}]*align-items: center;[^}]*padding: 16px;/);
  assert.match(styles, /\.stream-controls\s*\{[^}]*justify-content: space-between;/);
  assert.doesNotMatch(styles, /\.volume-control\s*\{[^}]*margin-left: auto/);
});
test("copy feedback escapes header stacking and keeps its banner offset", () => {
  let portal: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText() === "createPortal") portal = node; ts.forEachChild(node, visit); };
  visit(syntax("components/partner-actions.tsx"));
  assert.ok(portal); assert.equal(portal.arguments[1].getText(), "document.body");
  assert.match(portal.arguments[0].getText(), /className="copy-toast"/);
  assert.match(portal.arguments[0].getText(), /role="status"/);
  assert.match(source("app/globals.css"), /body:has\(\.has-site-banner\) > \.copy-toast/);
});
test("partner actions read Copy with and only the TV suffix receives Dune", async () => {
  const require = createRequire(resolve("../../webapp/package.json"));
  const { createElement } = require("react"); const { renderToStaticMarkup } = require("react-dom/server");
  async function render(path: string) {
    const built = await build({ entryPoints: [resolve("../../webapp/src", path)], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", alias: { "@": resolve("../../webapp/src") }, loader: { ".css": "empty" } });
    const module = { exports: {} as { default: unknown } };
    new Function("require", "module", "exports", built.outputFiles[0].text)(require,module,module.exports);
    return renderToStaticMarkup(createElement(module.exports.default)) as string;
  }
  const actions = await render("components/partner-actions.tsx");
  assert.match(actions, /Copy with/); assert.doesNotMatch(actions, /Clone with/);
  assert.match(actions, /Copy Reactor setup prompt for Codex/);
  const lockup = await render("components/reactor-tv-lockup.tsx");
  assert.match(lockup, /class="reactor-tv-suffix" fill="var\(--dune\)"/);
  assert.match(lockup, /aria-label="Reactor TV" fill="currentColor"/);
});

test("static stays quiet through a bounded fade and stops above clean playback", () => {
  const effect = source("app/stream/signal-static.tsx");
  assert.doesNotMatch(effect, /Math.random|pointermove|drawImage|useState|requestAnimationFrame/);
  assert.match(effect, /prefers-reduced-motion: reduce/);
  assert.match(effect, /data-ready=\{ready \|\| undefined\}/);
  assert.match(effect, /performance.now\(\) >= fadeEndsAt/);
  assert.match(effect, /canvas.hidden = true;\s*return/);
  assert.ok(STATIC_FADE_MS >= 600 && STATIC_FADE_MS <= 1000);
  assert.match(effect, /clearTimeout\(timer\)/);
  assert.match(effect, /observer.disconnect\(\)/);
  assert.match(effect, /document.hidden/);
  assert.match(effect, /setTimeout\(paint, ready \?/);
  assert.match(source("app/stream/broadcast-app.tsx"), /<SignalStatic ready=\{streamReady\}/);
  assert.match(source("app/globals.css"), /signal-static\[hidden\] \{ display: none/);
  assert.match(source("app/globals.css"), /signal-static\[data-ready\] \{ opacity: 0; transition-property: opacity/);
  assert.ok(STATIC_FRAME_MS >= 150);
  const first = staticTile(0), next = staticTile(1);
  assert.equal(first.length, STATIC_TILE_SIZE ** 2 * 4);
  assert.deepEqual(first, staticTile(0));
  assert.notDeepEqual(first, next);
  let sum=0;
  for(let i=0;i<first.length;i+=4) {
    assert.ok(first[i] <= 17, "Static stays below 7% white");
    assert.equal(first[i], first[i+1]); assert.equal(first[i], first[i+2]);
    assert.equal(first[i+3], 255); sum+=first[i];
  }
  assert.ok(sum / (first.length / 4) < 10, "No bright texture field");
});

test("only LIVE uses mono and countdowns share regular sans-serif typography", () => {
  const css = source("app/globals.css");
  const monoRules = [...css.matchAll(/([^{}]+)\{([^{}]*var\(--font-mono\)[^{}]*)\}/g)];
  assert.equal(monoRules.length,1);
  assert.equal(monoRules[0][1].trim(), ".stream-status[data-live] .stream-status-label");
  for(const file of ["app/stream/mobile.css","app/stream/voting.css"]) assert.doesNotMatch(source(file), /var\(--font-mono\)/);
  assert.match(css, /\.chunk-countdown \{[^}]*font: 400 13px var\(--font-sans\)/);
  assert.match(css, /\.segment-timer-info \{[^}]*font: 400 13px var\(--font-sans\)/);
  assert.match(css, /\.segment-timer-button \{[^}]*font: 400 13px var\(--font-sans\)/);
  assert.match(source("app/stream/mobile.css"), /@container player \(max-width: 899px\)/);
});

test("schedule has a visible opening affordance independent of the timer", async () => {
  const require = createRequire(resolve("../../webapp/package.json"));
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const built = await build({entryPoints: [resolve("../../webapp/src/app/stream/schedule-panel.tsx")], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", alias: {"@": resolve("../../webapp/src")}});
  const module = {exports: {} as {ScheduleButton: unknown; SegmentCountdown: unknown; SEGMENT_EXPLANATION: string}};
  new Function("require", "module", "exports", built.outputFiles[0].text)(require,module,module.exports);
  const render = (open: boolean) => renderToStaticMarkup(createElement(module.exports.ScheduleButton, {open,onClick:()=>{}}));
  const closed = render(false);
  assert.match(closed, /aria-label="View Schedule"/);
  assert.match(closed, /aria-haspopup="dialog"/);
  assert.match(closed, /aria-controls="broadcast-schedule"/);
  assert.match(closed, /<svg[^]*View Schedule/);
  assert.doesNotMatch(closed, /Next segment in/);
  assert.match(render(true), /aria-expanded="true"/);
  assert.match(render(true), /aria-label="Close schedule"/);
  assert.match(source("app/globals.css"), /\.segment-timer-button \{[^}]*background: var\(--dune\); color: var\(--interstellar\)/);

  const timer = (props: object) => renderToStaticMarkup(createElement(module.exports.SegmentCountdown, props));
  const live = timer({status: "live", segment: {durationSeconds: 120}, startedAt: 1000});
  assert.match(live, /Next segment in/);
  assert.match(live, /02:00/);
  assert.match(live, /aria-label="What is a segment\?"/);
  assert.match(live, /class="timer-help"[^]*aria-haspopup="dialog"/);
  assert.match(live, /popover="auto"[^]*role="dialog"/);
  assert.match(live, /popoverTargetAction="hide"/i);
  assert.ok(module.exports.SEGMENT_EXPLANATION.split(/\s+/).length < 60);
  assert.match(module.exports.SEGMENT_EXPLANATION, /Segments are the different shows on Reactor TV/);
  assert.match(module.exports.SEGMENT_EXPLANATION, /short video chunks/);
  assert.equal(timer({status: "offline", segment: {durationSeconds: 120}}), "");
  assert.equal(timer({status: "live"}), "");
  const starting = timer({status: "live", segment: {durationSeconds: 0}});
  assert.ok(starting.includes("Next segment starting..."));
  assert.ok(!starting.includes("00:00"));
  assert.ok(!starting.includes("Next segment in"));
  assert.ok(starting.includes('aria-label="What is a segment?"'));
  const lastSecond = timer({status: "live", segment: {durationSeconds: 0.1}});
  assert.ok(lastSecond.includes("00:01"));
  assert.ok(!lastSecond.includes("Next segment starting..."));
  assert.ok(timer({status: "live", segment: {durationSeconds: -1}}).includes("Next segment starting..."));
});

test("chunk and segment timers stay adjacent in the same responsive group", () => {
  let group: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (className(node) === "stream-timers") group = node; ts.forEachChild(node, visit); };
  visit(syntax("app/stream/broadcast-app.tsx"));
  assert.ok(group);
  const components: string[] = [];
  const collect = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node)) components.push(node.tagName.getText());
    ts.forEachChild(node, collect);
  };
  collect(group);
  assert.deepEqual(components, ["ChunkCountdown", "SegmentCountdown"]);
  assert.match(group.getText(), /aria-label="Playback timers"/);
  assert.doesNotMatch(group.getText(), /key=/, "Changing segments must not remount an open explainer");
  const mobile = source("app/stream/mobile.css");
  assert.ok(mobile.includes(".stream-controls .stream-timers { grid-column: 1 / -1; grid-row: 2; }"));
  assert.ok(mobile.includes(".stream-timers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }"));
  assert.ok(mobile.includes(".stream-timers .timer-copy { flex-direction: column;"));
  assert.match(source("app/globals.css"), /\.timer-help \{[^}]*width: 44px; height: 44px;/);
});

test("chunk help is a short accessible overlay with a playback countdown", async () => {
  const require = createRequire(resolve("../../webapp/package.json"));
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const built = await build({entryPoints: [resolve("../../webapp/src/app/stream/chunk-countdown.tsx")], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", alias: {"@": resolve("../../webapp/src")}});
  const module = {exports: {} as {default: unknown; CHUNK_EXPLANATION: string}};
  new Function("require", "module", "exports", built.outputFiles[0].text)(require,module,module.exports);
  const html = renderToStaticMarkup(createElement(module.exports.default, {chunkSeconds: 8, startedAt: 1000}));
  assert.match(html, /Next chunk in/);
  assert.doesNotMatch(source("app/stream/broadcast-app.tsx"), /key=\{broadcast.currentChunkStartedAt\}/, "Chunk boundaries must not remount and dismiss help");
  assert.match(html, /00:08/);
  assert.match(html, /aria-label="What is a chunk\?"/);
  assert.match(html, /class="timer-help"[^]*aria-haspopup="dialog"/);
  assert.match(html, /popover="auto"[^]*role="dialog"/);
  assert.match(html, /popoverTargetAction="hide"/i);
  assert.ok(module.exports.CHUNK_EXPLANATION.split(/\s+/).length < 60);
  assert.match(module.exports.CHUNK_EXPLANATION, /video and audio generated by FastH3/);
  assert.doesNotMatch(source("app/stream/mobile.css"), /\.chunk-countdown \{ display: none/);
});

test("public FastH3 links use the verified playground and a short native popover", async () => {
  const require = createRequire(resolve("../../webapp/package.json"));
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const built = await build({entryPoints: [resolve("../../webapp/src/app/stream/broadcast-links.tsx")], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", alias: {"@": resolve("../../webapp/src")}});
  const module = {exports: {} as {default: unknown; BROADCAST_EXPLANATION: string}};
  new Function("require", "module", "exports", built.outputFiles[0].text)(require,module,module.exports);
  const html = renderToStaticMarkup(createElement(module.exports.default));
  assert.match(html, /href="https:\/\/www.reactor.inc\/models\/fast-h3"/);
  assert.match(html, /Try FastH3 on Reactor/);
  assert.match(html, /popover="auto"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /popoverTargetAction="hide"/i);
  assert.match(html, /Learn more about FastH3 on Reactor/);
  assert.ok(module.exports.BROADCAST_EXPLANATION.split(/\s+/).length < 100);
});

test("the live status owns the realtime eye count, with exact accessible counts and compact large numbers", async () => {
  const require = createRequire(resolve("../../webapp/package.json"));
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const built = await build({ entryPoints: [resolve("../../webapp/src/app/stream/stream-status.tsx")], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic" });
  const module = { exports: {} as { default: unknown } };
  new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
  const render = (viewerCount: number | undefined, status = "live") => renderToStaticMarkup(createElement(module.exports.default, { viewerCount, status })) as string;
  for (const [count, visible, description] of [[0, "0", "0 current viewers"], [1, "1", "1 current viewer"], [999, "999", "999 current viewers"], [1234, "1.2K", "1,234 current viewers"], [1000000, "1M", "1,000,000 current viewers"]] as const) {
    const html = render(count);
    assert.match(html, /class="stream-status" data-live="true" role="status" aria-atomic="true"/);
    assert.ok(html.includes(`title="${description}"`));
    assert.ok(html.includes(`<span aria-hidden="true">${visible}</span>`));
    assert.ok(html.includes(`<span class="sr-only">${description}</span>`));
    assert.match(html, /class="stream-viewers"[^]*<svg[^]*aria-hidden="true"/);
  }
  assert.match(render(2, "starting"), /Connecting/);
  assert.match(render(undefined), /Loading current viewer count/);
  assert.match(render(undefined), /<span aria-hidden="true">…<\/span>/);
  assert.doesNotMatch(render(2, "offline"), /data-live/);
  const app = source("app/stream/broadcast-app.tsx");
  assert.match(app, /<StreamStatus status=\{streamReady[^]*?viewerCount=\{displayedViewerCount\(viewerCount, settings\)\}/);
  assert.doesNotMatch(app, /chat-viewers/);
  assert.match(app, /Latest messages ↓<\/button> : null/);
  assert.match(source("app/globals.css"), /\.stream-viewers \{[^}]*background: var\(--dune\); color: var\(--interstellar\); font: 400 16px var\(--font-sans\)/);
});
