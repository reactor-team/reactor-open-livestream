import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";
import { onAirViewerPrompt, promptPreview } from "../../../webapp/src/lib/on-air-prompt";

const prompt = { _id: "playing", status: "playing", author: "Moss", text: "A tiny storm cloud follows everyone around the room, raining only on their hats." };
const state = { ready: true, prompts: [prompt], currentPrompt: prompt.text, currentAuthor: prompt.author };

test("the live prompt must match both the playing row and the playback heartbeat", () => {
  assert.equal(onAirViewerPrompt(state), prompt);
  for (const status of ["pending", "queued", "played"]) {
    assert.equal(onAirViewerPrompt({ ...state, prompts: [{ ...prompt, status }] }), null);
  }
  assert.equal(onAirViewerPrompt({ ...state, ready: false }), null);
  assert.equal(onAirViewerPrompt({ ...state, prompts: undefined }), null);
  assert.equal(onAirViewerPrompt({ ...state, currentPrompt: "Continue the current segment with its next causal beat." }), null);
  assert.equal(onAirViewerPrompt({ ...state, currentAuthor: "Someone_else" }), null);
  assert.equal(onAirViewerPrompt({ ...state, currentPrompt: " " }), null);
});

test("prompt previews show a few words without altering the full prompt or breaking unicode", () => {
  assert.equal(promptPreview(prompt.text), "A tiny storm cloud follows everyone around the…");
  assert.equal(promptPreview("  It\nstarts   raining. "), "It starts raining.");
  assert.equal(promptPreview("one two three four five six seven eight"), "one two three four five six seven eight");
  assert.equal(promptPreview("a".repeat(800)), "a".repeat(96) + "…");
  assert.equal(promptPreview("🌧".repeat(100)), "🌧".repeat(96) + "…");
  assert.equal(promptPreview(""), "");
});

test("the preview opens a native popover containing the complete escaped text and author", async () => {
  const require = createRequire(resolve("../../webapp/package.json"));
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const built = await build({ entryPoints: [resolve("../../webapp/src/app/stream/on-air-prompt.tsx")], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", alias: { "@": resolve("../../webapp/src") } });
  const module = { exports: {} as { default: unknown } };
  new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
  const render = (value: typeof prompt | null) => renderToStaticMarkup(createElement(module.exports.default, { prompt: value })) as string;
  const html = render(prompt);
  assert.match(html, /class="on-air-prompt-trigger"[^]*aria-haspopup="dialog"/);
  assert.match(html, /popover="auto"[^]*role="dialog"/);
  assert.ok(html.includes(prompt.text));
  assert.ok(html.includes(promptPreview(prompt.text)));
  assert.match(html, /aria-label="Current prompt"/);
  assert.match(html, /class="on-air-prompt-label">Current prompt<\/span>/);
  assert.match(html, /class="on-air-prompt-quote">“<span class="on-air-prompt-preview">[^]*?<\/span>”<\/span>/);
  assert.ok(html.includes(`<p class="on-air-prompt-full">“${prompt.text}”</p>`));
  assert.match(html, /From <strong>Moss<\/strong>/);
  assert.doesNotMatch(render(null), /class="on-air-prompt-trigger"/);
  const escaped = render({ ...prompt, text: "<script>alert(1)</script>" });
  assert.ok(escaped.includes("&lt;script&gt;"));
  assert.doesNotMatch(escaped, /<script>/);
});

test("reading holds a prompt snapshot while the trigger follows playback", () => {
  const source = readFileSync(resolve("../../webapp/src/app/stream/on-air-prompt.tsx"), "utf8");
  assert.match(source, /reading \?\? prompt/);
  assert.match(source, /onOpen=\{\(\) => setReading\(prompt\)\}/);
  assert.match(source, /onClose=\{\(\) => setReading\(null\)\}/);
  const app = readFileSync(resolve("../../webapp/src/app/stream/broadcast-app.tsx"), "utf8");
  assert.match(app, /onAirViewerPrompt\(\{ ready: streamReady/);
  assert.match(app, /<OnAirPrompt prompt=\{onAirPrompt\}/);
  assert.doesNotMatch(app, /<OnAirPrompt[^>]*key=/);
});
