import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const data = require("emojibase-data/en/data.json");
const messages = require("emojibase-data/en/messages.json");
const shortcodes = require("emojibase-data/en/shortcodes/github.json");
const clean = text => text.replace(/[\u2013\u2014]/g, "-");
const catalog = {};
for (const entry of data) {
  if (entry.group === undefined || entry.group === 2) continue;
  for (const emoji of [entry, ...(entry.skins ?? [])]) {
    const code = [...emoji.emoji.replace(/\uFE0F/g, "")].map(char => char.codePointAt(0).toString(16)).join("-");
    catalog[`emoji:${code}`] = [emoji.emoji, clean(emoji.label)];
  }
  const codes = shortcodes[entry.hexcode];
  entry.tags = [...new Set([...(entry.tags ?? []), ...[codes ?? []].flat(), entry.emoji])];
}
const files = {
  "packages/contracts/src/emoji-catalog.json": "{\n" + Object.entries(catalog).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(",\n") + "\n}\n",
  "webapp/public/emoji/17/en/data.json": clean(JSON.stringify(data, null, 2)) + "\n",
  "webapp/public/emoji/17/en/messages.json": clean(JSON.stringify(messages)) + "\n",
  "webapp/public/emoji/17/LICENSE": readFileSync(require.resolve("emojibase-data/LICENSE"), "utf8"),
};
if (process.argv.includes("--check")) {
  for (const [file, content] of Object.entries(files)) {
    if (readFileSync(root + file, "utf8") !== content) throw new Error(`Emoji asset drift: ${file}`);
  }
  console.log(`Verified ${Object.keys(catalog).length} emoji variants and self-hosted picker data.`);
} else if (process.argv.includes("--list")) {
  console.log(JSON.stringify(Object.entries(files).map(([file, content]) => ({ file, lines: content.trimEnd().split("\n").length }))));
} else {
  const file = process.argv[2];
  const start = Number(process.argv[3] ?? 0);
  if (!(file in files) || !Number.isInteger(start) || start < 0) throw new Error("Pass an output file and optional starting line, or --list / --check.");
  const lines = files[file].trimEnd().split("\n");
  const header = start ? `*** Update File: ${root + file}\n@@\n${lines.slice(Math.max(0, start - 2), start).map(line => " " + line).join("\n")}\n` : `*** Add File: ${root + file}\n`;
  process.stdout.write("*** Begin Patch\n" + header + lines.slice(start, start + 500).map(line => "+" + line).join("\n") + (start ? "\n*** End of File" : "") + "\n*** End Patch\n");
}
