import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { toggleBrowserFullscreen, type FullscreenDocument } from "../../../webapp/src/lib/fullscreen";

function mockDocument() {
  const calls: unknown[] = [];
  const doc: { -readonly [K in keyof FullscreenDocument]: FullscreenDocument[K] } = {
    fullscreenElement: null,
    fullscreenEnabled: true,
    documentElement: { requestFullscreen: async (options) => { calls.push(options); } },
    exitFullscreen: async () => { calls.push("exit"); },
  };
  return { doc, calls };
}

test("fullscreen requests the document immediately with browser navigation hidden", async () => {
  const { doc, calls } = mockDocument();
  const request = toggleBrowserFullscreen(doc);
  assert.deepEqual(calls, [{ navigationUI: "hide" }], "Must run within the click's transient activation");
  await request;
});

test("fullscreen exits actual native state instead of requesting it again", async () => {
  const { doc, calls } = mockDocument();
  doc.fullscreenElement = {} as Element;
  await toggleBrowserFullscreen(doc);
  assert.deepEqual(calls, ["exit"]);
});

test("unsupported and denied fullscreen remain failures, with no fake theatre fallback", async () => {
  const { doc, calls } = mockDocument();
  doc.fullscreenEnabled = false;
  await assert.rejects(toggleBrowserFullscreen(doc), /unavailable/);
  assert.deepEqual(calls, []);
  doc.fullscreenEnabled = true;
  doc.documentElement.requestFullscreen = undefined as unknown as HTMLElement["requestFullscreen"];
  await assert.rejects(toggleBrowserFullscreen(doc), /unavailable/);
  doc.documentElement.requestFullscreen = async () => { throw new Error("Denied"); };
  await assert.rejects(toggleBrowserFullscreen(doc), /Denied/);
  doc.fullscreenElement = {} as Element;
  doc.exitFullscreen = async () => { throw new Error("Exit denied"); };
  await assert.rejects(toggleBrowserFullscreen(doc), /Exit denied/);
});

test("fullscreen control renders without browser globals and synchronizes browser exits", async () => {
  const require = createRequire(resolve("../../webapp/package.json"));
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const entry = resolve("../../webapp/src/app/stream/fullscreen-toggle.tsx");
  const built = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", alias: { "@": resolve("../../webapp/src") } });
  const module = { exports: {} as { default: unknown } };
  new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
  const html = renderToStaticMarkup(createElement(module.exports.default));
  assert.match(html, /aria-label="Enter fullscreen"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /type="button"/);
  const source = readFileSync(entry, "utf8");
  assert.match(source, /addEventListener\("fullscreenchange", onChange\)/);
  assert.match(source, /removeEventListener\("fullscreenchange", onChange\)/);
  assert.match(source, /Boolean\(document.fullscreenElement\)/);
  assert.match(source, /if \(pending.current\) return/);
  assert.match(source, /Dismiss fullscreen notification/);
  assert.doesNotMatch(source, /preventDefault|requestPointerLock|keyboard\.lock/);
  const app = readFileSync(resolve("../../webapp/src/app/stream/broadcast-app.tsx"), "utf8");
  assert.match(app, /<FullscreenToggle \/>/);
});
