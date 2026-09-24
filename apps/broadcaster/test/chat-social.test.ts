import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { CHAT_REACTIONS, completeMention, isReactionKey, MAX_REACTION_TYPES, MAX_REACTIONS_PER_VIEWER, mentionAtCaret, mentionTokens, reactionDetails, reactionKeyForEmoji, VIEWER_NAME_COOLDOWN_MS } from "@reactor/infinite-contracts";
import emojiCatalog from "../../../packages/contracts/src/emoji-catalog.json";
import { addRecentEmoji, emojiPopoverPosition, parseRecentEmojis, rememberEmoji } from "../../../webapp/src/lib/recent-emojis";
import * as chat from "../../../webapp/convex/chat";
import * as viewers from "../../../webapp/convex/viewers";
import * as prompts from "../../../webapp/convex/prompts";
import * as migrations from "../../../webapp/convex/chatMigrations";
import { awardPromptStar, resolveMentions } from "../../../webapp/convex/lib/chatSocial";

type Row = Record<string, any> & { _id: string };
test("the broadcaster can load reaction contracts in native Node without a bundler", () => {
  const result = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { isReactionKey } from "@reactor/infinite-contracts";
    if (!isReactionKey("emoji:1f984")) process.exit(1);
  `], { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 10_000 });
  assert.equal(result, "");
});
const run = (fn: any, ctx: any, args: object = {}) => fn._handler(ctx, args);
function context() {
  const tables = new Map<string, Row[]>();
  const table = (name: string) => { if (!tables.has(name)) tables.set(name, []); return tables.get(name)!; };
  const db = {
    query(name: string) {
      let rows = [...table(name)];
      const query = {
        withIndex(_index: string, filter?: (f: any) => void) {
          const f = {
            eq(key: string, value: unknown) { rows = rows.filter(row => row[key] === value); return f; },
            gte(key: string, value: any) { rows = rows.filter(row => row[key] !== undefined && row[key] >= value); return f; },
            lt(key: string, value: any) { rows = rows.filter(row => row[key] < value); return f; },
          };
          filter?.(f); return query;
        },
        order(direction: string) { rows.sort((a, b) => (direction === "desc" ? -1 : 1) * (a.createdAt - b.createdAt)); return query; },
        first: async () => rows[0] ?? null, unique: async () => { assert.ok(rows.length <= 1); return rows[0] ?? null; },
        collect: async () => rows, take: async (count: number) => rows.slice(0, count),
        paginate: async ({ cursor, numItems }: any) => ({ page: rows.slice(Number(cursor ?? 0), Number(cursor ?? 0) + numItems), continueCursor: String(Number(cursor ?? 0) + numItems), isDone: Number(cursor ?? 0) + numItems >= rows.length }),
      };
      return query;
    },
    get: async (id: string) => [...tables.values()].flat().find(row => row._id === id) ?? null,
    insert: async (name: string, value: object) => { const _id = crypto.randomUUID(); table(name).push({ ...value, _id, _creationTime: Date.now() }); return _id; },
    patch: async (id: string, value: object) => { const row = await db.get(id); assert.ok(row); Object.assign(row, value); },
    delete: async (id: string) => { for (const rows of tables.values()) { const i = rows.findIndex(row => row._id === id); if (i >= 0) rows.splice(i, 1); } },
  };
  return { db, tables };
}

test("reactions and likes are independent, reversible and idempotent per browser identity", async () => {
  const ctx = context();
  for (const name of ["Moss", "Fern"]) await run(viewers.setName, ctx, { name, identity: name });
  const messageId = await run(chat.send, ctx, { identity: "Moss", author: "Moss", body: "Hello" });
  const args = { messageId, identity: "Fern", author: "Fern", key: "like", active: true };
  await run(chat.setReaction, ctx, args); await run(chat.setReaction, ctx, args);
  await run(chat.setReaction, ctx, { ...args, identity: "Moss", author: "Moss" });
  for (const { key } of CHAT_REACTIONS) await run(chat.setReaction, ctx, { ...args, key });
  assert.equal((await ctx.db.get(messageId))?.reactionCounts.like, 2);
  assert.equal(ctx.tables.get("messageReactions")?.length, 10);
  assert.equal((await run(chat.ownReactions, ctx, { identity: "Fern", messageIds: [messageId] }))[messageId].length, 9);
  assert.deepEqual((await run(chat.ownReactions, ctx, { identity: "Moss", messageIds: [messageId] }))[messageId], ["like"]);
  await run(chat.setReaction, ctx, { ...args, active: false }); await run(chat.setReaction, ctx, { ...args, active: false });
  assert.equal((await run(chat.recent, ctx))[0].reactionCounts.like, 1);
  await run(chat.setReaction, ctx, { ...args, key: "fire", active: false });
  assert.equal((await ctx.db.get(messageId))?.reactionCounts.fire, undefined);
  assert.equal((await ctx.db.get(messageId))?.reactionCounts.laugh, 1);
});

test("reaction writes reject missing names, forged authors, invalid keys and system or missing messages", async () => {
  const ctx = context();
  await run(viewers.setName, ctx, { name: "Moss", identity: "moss" });
  const messageId = await run(chat.send, ctx, { identity: "moss", author: "Moss", body: "Hello" });
  const args = { messageId, identity: "moss", author: "Moss", key: "like", active: true };
  for (const patch of [{ identity: "unknown" }, { identity: "bad identity" }, { author: "Forged" }, { key: "arbitrary" }, { messageId: "missing" }]) await assert.rejects(run(chat.setReaction, ctx, { ...args, ...patch }));
  await ctx.db.patch(messageId, { systemKind: "vote-open" });
  await assert.rejects(run(chat.setReaction, ctx, args));
  assert.equal(ctx.tables.get("messageReactions")?.length ?? 0, 0);
  await assert.rejects(run(chat.ownReactions, ctx, { identity: "moss", messageIds: Array(101).fill(messageId) }));
});

test("accepted prompts earn exactly one durable star; admission failures and playback never do", async t => {
  const ctx = context(); let now = 1000;
  t.mock.method(Date, "now", () => now);
  await run(viewers.setName, ctx, { name: "Moss", identity: "moss" });
  const input = { author: "Moss", identity: "moss", text: "Make it rain" };
  const result = await run(prompts.acceptSubmission, ctx, input);
  assert.equal(result.status, "accepted");
  assert.equal(await awardPromptStar(ctx as any, result.promptId), false);
  assert.equal((await run(prompts.acceptSubmission, ctx, input)).status, "invalid");
  assert.equal(ctx.tables.get("viewerStars")?.[0].count, 1);
  await ctx.db.patch(result.promptId, { status: "played" });
  now += VIEWER_NAME_COOLDOWN_MS;
  await run(viewers.setName, ctx, { name: "Fern", identity: "moss" });
  await run(prompts.acceptSubmission, ctx, { ...input, author: "Fern" });
  await run(chat.send, ctx, { body: "Chat earns nothing", identity: "moss", author: "Fern" });
  assert.equal(ctx.tables.get("viewerStars")?.[0].count, 2);
  assert.ok((await run(chat.recent, ctx)).every((row: any) => row.stars === 2));
  assert.equal(ctx.tables.get("messages")?.[0].author, "Moss");
});

test("historical star migration is paginated, restartable and excludes protected direct playback", async () => {
  const ctx = context();
  for (let i = 0; i < 203; i++) await ctx.db.insert("prompts", { identity: "legacy", author: "Viewer_123abc", text: "Past prompt", status: "played", playNow: i < 3 });
  let cursor = null; let awarded = 0; let pages = 0;
  for (;;) { const result = await run(migrations.backfillStars, ctx, { cursor }); awarded += result.awarded; pages++; if (result.done) break; cursor = result.cursor; }
  assert.equal(pages, 3); assert.equal(awarded, 200);
  assert.equal(ctx.tables.get("viewerStars")?.[0].count, 200);
  assert.equal((await run(migrations.backfillStars, ctx, { cursor: null })).awarded, 0);
  assert.equal((migrations.backfillStars as any).isInternal, true);
});

test("mention parsing respects token boundaries and replaces only the active caret token", () => {
  assert.deepEqual(mentionTokens("Hi @Moss, @fern_2! email@moss.com @@bad @" + "x".repeat(25)).map(item => item.name), ["Moss", "fern_2"]);
  assert.equal(mentionAtCaret("mail@moss", 9), null);
  assert.deepEqual(mentionAtCaret("Hi @Mo!", 6), { search: "mo", start: 3, end: 6 });
  assert.deepEqual(mentionAtCaret("Hi @Moss later", 5), { search: "m", start: 3, end: 8 });
  assert.deepEqual(completeMention("Hi @Mo, later", { start: 3, end: 6 }, "Moss"), { text: "Hi @Moss, later", caret: 8 });
  assert.deepEqual(completeMention("Hi @Mo later", { start: 3, end: 6 }, "Moss"), { text: "Hi @Moss later", caret: 9 });
  assert.deepEqual(mentionAtCaret("/prompt @", 9), { search: "", start: 8, end: 9 });
});

test("mention directory is case-insensitive, bounded, updated on rename and migrated without changing names", async t => {
  const ctx = context(); let now = 1000;
  t.mock.method(Date, "now", () => now);
  for (const name of ["Moss", "Mossy", "Fern"]) await run(viewers.setName, ctx, { identity: name, name });
  await ctx.db.insert("viewers", { identity: "legacy", name: "Morgan", createdAt: 1 });
  await run(migrations.backfillNames, ctx, { cursor: null });
  assert.deepEqual(await run(viewers.mentionSuggestions, ctx, { search: "MO" }), ["Moss", "Mossy", "Morgan"]);
  assert.deepEqual(await run(viewers.mentionSuggestions, ctx, { search: "<script>" }), []);
  const messageId = await run(chat.send, ctx, { identity: "Fern", author: "Fern", body: "Hello @moss @unknown" });
  assert.deepEqual((await ctx.db.get(messageId))?.mentions, [{ name: "Moss", identity: "Moss" }]);
  now += VIEWER_NAME_COOLDOWN_MS;
  await run(viewers.setName, ctx, { identity: "Moss", name: "Stone" });
  assert.deepEqual((await ctx.db.get(messageId))?.mentions, [{ name: "Moss", identity: "Moss" }], "historical recipient stays stable");
  assert.deepEqual(await resolveMentions(ctx as any, "@Moss @Stone @Stone"), [{ name: "Stone", identity: "Moss" }]);
  const prompt = await run(prompts.acceptSubmission, ctx, { identity: "Fern", author: "Fern", text: "@Stone make it rain" });
  assert.equal(prompt.status, "accepted");
  assert.deepEqual(ctx.tables.get("messages")?.at(-1)?.mentions, [{ name: "Stone", identity: "Moss" }]);
});

test("social markup is escaped, accessible and has no star-mechanic explanation", async () => {
  const require = createRequire(resolve("../../webapp/package.json"));
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const built = await build({ entryPoints: [resolve("../../webapp/src/app/stream/chat-social.tsx")], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic" });
  const module = { exports: {} as any };
  new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
  const { default: Reactions, ChatMessageMeta, UserStars, MentionText } = module.exports;
  assert.equal(renderToStaticMarkup(createElement(UserStars, { count: 0 })), "");
  const stars = renderToStaticMarkup(createElement(UserStars, { count: 20 }));
  assert.match(stars, /aria-label="20 stars"/); assert.doesNotMatch(stars, /prompt|earn|title=/i);
  const html = renderToStaticMarkup(createElement(Reactions, { counts: { like: 2, fire: 1 }, selected: ["like"], onReact: async () => {}, onError() {} }));
  assert.match(html, /aria-label="Unlike message, 2 likes" aria-pressed="true"/);
  assert.match(html, /aria-label="Add reaction" aria-haspopup="dialog" aria-expanded="false"/);
  assert.doesNotMatch(html, /frimousse|Choose a reaction/, "The full picker mounts only when opened");
  assert.match(html, /aria-label="Fire, 1 reaction"/);
  assert.match(html, /^<span class="chat-reactions">/);
  assert.doesNotMatch(html, /<div|<br/);
  assert.equal(renderToStaticMarkup(createElement(ChatMessageMeta, {})), "");
  const meta = renderToStaticMarkup(createElement(ChatMessageMeta, { timing: { label: "Aired", title: "Prompt aired" }, status: "played" },
    createElement(Reactions, { counts: { like: 1 }, selected: ["like"], onReact: async () => {}, onError() {} })));
  assert.match(meta, /^<span class="chat-message-meta"><small class="chat-prompt-status" data-tone="played" title="Prompt aired">Aired<\/small><span class="chat-reactions">/);
  assert.doesNotMatch(meta, /<div|<br/);
  const queuedWithoutSocial = renderToStaticMarkup(createElement(ChatMessageMeta, { timing: { label: "#1 in queue · about 10s", title: "Generating video" }, status: "queued" }));
  assert.match(queuedWithoutSocial, /#1 in queue · about 10s/);
  assert.doesNotMatch(queuedWithoutSocial, /<button/);
  const mentioned = renderToStaticMarkup(createElement(MentionText, { text: "<script> @Moss", mentions: [{ name: "Moss", identity: "one" }], identity: "one" }));
  assert.match(mentioned, /&lt;script&gt;/); assert.match(mentioned, /data-self="true"/); assert.doesNotMatch(mentioned, /<script>/);
});

test("emoji keys accept the catalog, preserve legacy counts and reject arbitrary or duplicate encodings", () => {
  assert.ok(Object.keys(emojiCatalog).length > 3900);
  for (const emoji of ["🦄", "🦋", "🏳️‍🌈", "🇬🇧", "👍🏽", "👩🏿‍💻", "1️⃣"]) {
    const key = reactionKeyForEmoji(emoji)!;
    assert.ok(isReactionKey(key), emoji);
    assert.ok(reactionDetails(key)?.label);
  }
  for (const { key, emoji } of CHAT_REACTIONS) {
    assert.equal(reactionKeyForEmoji(emoji), key);
    assert.equal(reactionKeyForEmoji(emoji + "\uFE0F"), key);
  }
  for (const key of ["arbitrary", "__proto__", "constructor", "emoji:1f602", "emoji:unknown", "🦄", "emoji:1f984-1f984"]) assert.equal(isReactionKey(key), false, key);
  for (const text of ["hello", "🦄🦄", "<script>", "🦄".repeat(100), "1", ""]) assert.equal(reactionKeyForEmoji(text), undefined);
});

test("all-emoji reactions stay bounded, reversible, and visible in personal selections beyond the old eight", async () => {
  const ctx = context();
  for (const identity of ["Moss", "Fern", "Leaf"]) await run(viewers.setName, ctx, { name: identity, identity });
  const messageId = await run(chat.send, ctx, { identity: "Moss", author: "Moss", body: "Hello" });
  const keys = Object.keys(emojiCatalog).filter(isReactionKey);
  const args = { messageId, identity: "Moss", author: "Moss", active: true };
  for (const key of keys.slice(0, MAX_REACTIONS_PER_VIEWER)) await run(chat.setReaction, ctx, { ...args, key });
  assert.equal((await run(chat.ownReactions, ctx, { identity: "Moss", messageIds: [messageId] }))[messageId].length, MAX_REACTIONS_PER_VIEWER);
  await assert.rejects(run(chat.setReaction, ctx, { ...args, key: keys[MAX_REACTIONS_PER_VIEWER] }), /Remove one/);
  await run(chat.setReaction, ctx, { ...args, key: keys[0] });
  await run(chat.setReaction, ctx, { ...args, key: keys[0], active: false });
  await run(chat.setReaction, ctx, { ...args, key: keys[MAX_REACTIONS_PER_VIEWER] });
  for (const key of keys.slice(MAX_REACTIONS_PER_VIEWER + 1, MAX_REACTION_TYPES + 1)) await run(chat.setReaction, ctx, { ...args, identity: "Fern", author: "Fern", key });
  assert.equal(Object.keys((await ctx.db.get(messageId))!.reactionCounts).length, MAX_REACTION_TYPES);
  await assert.rejects(run(chat.setReaction, ctx, { ...args, identity: "Leaf", author: "Leaf", key: keys[MAX_REACTION_TYPES + 1] }), /existing one/);
  await run(chat.setReaction, ctx, { ...args, identity: "Leaf", author: "Leaf", key: keys[1] });
  assert.equal((await ctx.db.get(messageId))!.reactionCounts[keys[1]], 2);
});

test("recent emojis are deduplicated, most recent first, bounded, validated and optional", t => {
  const unicorn = reactionKeyForEmoji("🦄")!;
  assert.deepEqual(parseRecentEmojis(JSON.stringify(["fire", unicorn, "fire", "like", "__proto__", 7])), ["fire", unicorn]);
  for (const bad of [null, "not json", "{}", '"fire"']) assert.deepEqual(parseRecentEmojis(bad), []);
  assert.deepEqual(addRecentEmoji(["fire", unicorn], unicorn), [unicorn, "fire"]);
  assert.deepEqual(addRecentEmoji(["fire"], "like"), ["fire"]);
  assert.equal(parseRecentEmojis(JSON.stringify(Object.keys(emojiCatalog))).length, 24);
  const storage = { getItem: () => { throw new Error("Storage blocked"); }, setItem: () => { throw new Error("Storage blocked"); } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage"); });
  assert.doesNotThrow(() => rememberEmoji(unicorn));
});

test("emoji popovers fit phones, keyboard-reduced viewports, desktop edges and fullscreen", () => {
  for (const width of [280, 320, 390, 768, 1440, 3840]) for (const height of [220, 500, 900]) {
    const viewport = { width, height, left: 0, top: 100 };
    const size = { width: Math.min(352, width - 16), height: Math.min(420, height - 16) };
    const position = emojiPopoverPosition({ left: width - 24, top: height + 50, bottom: height + 74 }, size, viewport);
    assert.ok(position.left >= 8 && position.left + size.width <= width - 8);
    assert.ok(position.top >= 108 && position.top + size.height <= height + 92);
  }
  const source = readFileSync(resolve("../../webapp/src/app/stream/chat-social.tsx"), "utf8");
  assert.match(source, /createPortal\([\s\S]*document.body/);
  assert.match(source, /popover="auto"/);
  assert.match(source, /visual\?\.addEventListener\("resize", position\)/);
  assert.match(source, /await onReact\(key, active\);\s+if \(active\) rememberEmoji\(key\)/);
  assert.match(source, /lazy\(\(\) => import\("\.\/emoji-picker"\)\)/);
});

test("chat metadata flows inline and only wraps for available space, without reducing touch targets", () => {
  const css = readFileSync(resolve("../../webapp/src/app/stream/chat-social.css"), "utf8");
  const globals = readFileSync(resolve("../../webapp/src/app/globals.css"), "utf8");
  const app = readFileSync(resolve("../../webapp/src/app/stream/broadcast-app.tsx"), "utf8");
  assert.match(css, /\.chat-message-meta \{ display: inline-flex;[^}]*flex-wrap: wrap;[^}]*max-width: calc\(100% - 6px\)/);
  assert.match(css, /\.chat-message-meta > \.chat-reactions \{ display: contents; \}/);
  assert.match(globals, /\.chat-prompt-status \{ display: inline-block;[^}]*font: 400 10px\/1.35/);
  assert.doesNotMatch(globals.match(/\.chat-prompt-status \{[^}]+\}/)?.[0] ?? "", /border-left|text-transform|margin-top/);
  assert.match(css, /min-height: 24px; min-width: 24px/);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*min-height: 36px; min-width: 36px/);
  assert.match(app, /<ChatMessageMeta timing=\{timing\}[\s\S]*<ChatReactions[\s\S]*<\/ChatMessageMeta>/);
});
