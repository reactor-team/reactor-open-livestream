import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chatPromptPreview } from "../../../webapp/src/lib/chat-prompt-preview";

test("chat prompts stay whole through 100 characters and truncate longer text without splitting graphemes", () => {
  for (const text of ["", "It starts raining.", "a".repeat(100), "👩🏽‍🚀".repeat(100)]) {
    assert.deepEqual(chatPromptPreview(text), { text, truncated: false });
  }
  assert.deepEqual(chatPromptPreview("a".repeat(101)), { text: "a".repeat(100) + "…", truncated: true });
  assert.deepEqual(chatPromptPreview("👩🏽‍🚀".repeat(101)), { text: "👩🏽‍🚀".repeat(100) + "…", truncated: true });
  assert.deepEqual(chatPromptPreview("e\u0301".repeat(101)), { text: "e\u0301".repeat(100) + "…", truncated: true });
});

test("long previews end on a nearby word boundary and collapse whitespace without changing the original", () => {
  const text = "A".repeat(85) + "\n\n" + "aVeryLongWord".repeat(5);
  assert.equal(chatPromptPreview(text).text, "A".repeat(85) + "…");
  assert.ok(text.includes("\n\n"));
  assert.ok(!chatPromptPreview(text).text.includes("\n"));
});

test("chat disclosure renders only a short escaped preview with accessible independent controls", async () => {
  const require = createRequire(resolve("../../webapp/package.json"));
  const { createElement, Fragment } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const built = await build({ entryPoints: [resolve("../../webapp/src/app/stream/chat-prompt-text.tsx")], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", alias: { "@": resolve("../../webapp/src") } });
  const module = { exports: {} as { default: unknown } };
  new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
  const long = "<script>alert(1)</script> " + "A small cloud hovers over the room. ".repeat(20) + "END_OF_PROMPT";
  const html = renderToStaticMarkup(createElement(Fragment, {},
    createElement(module.exports.default, { text: long }),
    createElement(module.exports.default, { text: long }),
  ));
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|END_OF_PROMPT/);
  assert.equal((html.match(/See More/g) ?? []).length, 2);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 2);
  const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(controls).size, 2);
  for (const id of controls) assert.ok(html.includes(`id="${id}"`));
  assert.doesNotMatch(renderToStaticMarkup(createElement(module.exports.default, { text: "a".repeat(100) })), /<button|See More/);
});

test("shared and private prompt messages use the disclosure without truncating chat or edit values", () => {
  const app = readFileSync("../../webapp/src/app/stream/broadcast-app.tsx", "utf8");
  const privateMessage = readFileSync("../../webapp/src/app/stream/private-prompt-message.tsx", "utf8");
  const disclosure = readFileSync("../../webapp/src/app/stream/chat-prompt-text.tsx", "utf8");
  assert.match(app, /item.kind === "prompt" \? <ChatPromptText text=\{item.body\} onExpand=\{pauseChatForReading\} mentions=\{item.mentions\} identity=\{identity\} \/> : <MentionText text=\{item.body\}/);
  assert.match(app, /function pauseChatForReading\(\) \{\s*followChat.current = false;\s*setChatPaused\(true\)/);
  assert.match(privateMessage, /<ChatPromptText text=\{entry.body\} onExpand=\{onExpand\}/);
  assert.match(privateMessage, /onEdit\(entry.body\)/);
  assert.match(disclosure, /expanded \? text : preview.text/);
  assert.match(disclosure, /expanded \? "See Less" : "See More"/);
  const css = readFileSync("../../webapp/src/app/globals.css", "utf8");
  assert.match(css, /\.chat-panel \.chat-prompt-toggle \{[^}]*padding: 0;[^}]*border: 0;[^}]*background: transparent;[^}]*font: 400 12px\/1.35 var\(--font-sans\);[^}]*text-transform: none;[^}]*text-decoration: underline;[^}]*text-decoration-thickness: 1px;/);
});

test("shared prompt bodies are quieter than chat without dimming names, controls or private feedback", () => {
  const css = readFileSync("../../webapp/src/app/globals.css", "utf8");
  assert.match(css, /\.chat-prompt:not\(\.chat-private-prompt\) \.chat-prompt-text \{ color: color-mix\(in srgb, var\(--urban\) 90%, var\(--interstellar\)\); \}/);
  assert.match(css, /\.chat-message-body \{ color: rgba\(255, 255, 255, 0\.8\); \}/);
});
