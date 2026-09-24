import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";
import { formatChatTimestamp } from "../../../webapp/src/lib/chat-timestamp";
import { mergeVoteOutcomes } from "../../../webapp/src/lib/chat-messages";

const createdAt = Date.parse("2026-09-08T23:04:12.000Z");

test("chat timestamps use local time and the locale's clock convention", () => {
  const us = formatChatTimestamp(createdAt, { locale: "en-US", timeZone: "America/Los_Angeles" })!;
  assert.equal(us.label, "4:04 PM");
  assert.equal(us.dateTime, "2026-09-08T23:04:12.000Z");
  assert.match(us.fullLabel, /September 8, 2026/);
  assert.match(us.fullLabel, /4:04:12 PM PDT/);
  const uk = formatChatTimestamp(createdAt, { locale: "en-GB", timeZone: "Europe/London" })!;
  assert.equal(uk.label, "0:04");
  assert.match(uk.fullLabel, /9 September 2026/);
  assert.equal(formatChatTimestamp(createdAt, { locale: "en-GB", timeZone: "Asia/Kolkata" })!.label, "4:34");
  assert.equal(formatChatTimestamp(createdAt)!.label,
    new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(createdAt));
});

test("timestamps account for daylight saving transitions without a fixed UTC offset", () => {
  const options = { locale: "en-US", timeZone: "America/Los_Angeles" };
  assert.equal(formatChatTimestamp(Date.parse("2026-03-08T09:59:00Z"), options)!.label, "1:59 AM");
  assert.equal(formatChatTimestamp(Date.parse("2026-03-08T10:01:00Z"), options)!.label, "3:01 AM");
});

test("bad timestamps disappear without breaking the message or inventing a time", () => {
  for (const value of [NaN, Infinity, -Infinity, 9e15, undefined]) {
    assert.equal(formatChatTimestamp(value as number), null);
  }
  assert.ok(formatChatTimestamp(0));
});

test("local timestamps wait for hydration and expose an exact accessible date", async () => {
  const built = await build({
    entryPoints: [resolve("../../webapp/src/app/stream/chat-timestamp.tsx")],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    jsx: "automatic", alias: { "@": resolve("../../webapp/src") },
  });
  const require = createRequire(resolve("../../webapp/package.json"));
  const react = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const render = (hydrated: boolean, value = createdAt) => {
    const module = { exports: {} as { default: unknown } };
    const load = (name: string) => name === "react" && hydrated
      ? { ...react, useSyncExternalStore: (_subscribe: unknown, snapshot: () => boolean) => snapshot() }
      : require(name);
    new Function("require", "module", "exports", built.outputFiles[0].text)(load, module, module.exports);
    return renderToStaticMarkup(react.createElement(module.exports.default, { createdAt: value }));
  };
  assert.equal(render(false), "", "SSR must not display its own timezone before hydration");
  const html = render(true);
  assert.match(html, /<time class="chat-timestamp" dateTime="2026-09-08T23:04:12.000Z"/);
  assert.match(html, /title="[^"]+"/);
  assert.match(html, /aria-label="[^"]+"/);
  assert.ok(html.includes(formatChatTimestamp(createdAt)!.label));
  assert.equal(render(true, NaN), "");
});

test("every chat renderer uses creation time, including private moderation entries", () => {
  for (const [file, owner] of [
    ["broadcast-app.tsx", "item"], ["channel-message.tsx", "event"], ["private-prompt-message.tsx", "entry"],
  ]) {
    assert.ok(readFileSync("../../webapp/src/app/stream/" + file, "utf8")
      .includes("<ChatTimestamp createdAt={" + owner + ".createdAt} />"));
  }
  const css = readFileSync("../../webapp/src/app/globals.css", "utf8");
  assert.match(css, /\.chat-timestamp \{[^}]*font-family: var\(--font-sans\)/);
  assert.match(css, /\.chat-timestamp \{[^}]*white-space: nowrap/);
});

test("merged winner updates retain the original message timestamp and order", () => {
  const winner = { _id: "winner", kind: "system", roundId: "one", systemKind: "vote-winner", createdAt };
  const viewer = { _id: "viewer", kind: "message", createdAt: createdAt + 1000 };
  const playing = { ...winner, _id: "playing", systemKind: "vote-playing", createdAt: createdAt + 2000 };
  const rows = mergeVoteOutcomes([winner, viewer, playing]);
  assert.deepEqual(rows, [{ ...playing, _id: winner._id, createdAt }, viewer]);
  assert.equal(playing.createdAt, createdAt + 2000, "Stored events remain unchanged");
});
