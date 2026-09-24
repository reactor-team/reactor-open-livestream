import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import * as settings from "../../../webapp/convex/settings";
import { BASE_PROMPT_RULES, validatePromptCriteria } from "../../../webapp/convex/lib/promptModerationPolicy";
import { moderatePrompt, MODERATION_REASONS, MODERATION_UNAVAILABLE, PROMPT_MODERATION_POLICY } from "../../../webapp/convex/lib/promptModeration";
import * as prompts from "../../../webapp/convex/prompts";
import * as chat from "../../../webapp/convex/chat";
import { mergePrivatePrompts, type PrivatePromptEntry } from "../../../webapp/src/lib/private-prompts";

const input = { text: "It starts raining hard.", author: "Riley", identity: "viewer" };
const completion = (category: string) => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ category }) } }] });
const run = (fn: any, ctx: any, args: any = {}) => fn._handler(ctx, args);
function context() {
  const tables = new Map<string, any[]>();
  tables.set("viewers", [{ _id: "profile", identity: "viewer", name: "Riley", createdAt: 0 }]);
  const table = (name: string) => { if (!tables.has(name)) tables.set(name, []); return tables.get(name)!; };
  const db = {
    query(name: string) {
      let rows = [...table(name)];
      const query = {
        withIndex(_index: string, filter?: (f: any) => void) {
          const f = { eq(key: string, value: unknown) { rows = rows.filter(row => row[key] === value); return f; } };
          filter?.(f); return query;
        },
        order() { return query; }, take: async (n: number) => rows.slice(0, n), collect: async () => rows,
        first: async () => rows[0] ?? null, unique: async () => { assert.ok(rows.length <= 1); return rows[0] ?? null; },
      };
      return query;
    },
    get: async (id: string) => [...tables.values()].flat().find(row => row._id === id) ?? null,
    insert: async (name: string, value: any) => { const _id = name + crypto.randomUUID(); table(name).push({ ...value, _id }); return _id; },
    patch: async (id: string, value: any) => { Object.assign(await db.get(id), value); },
  };
  const ctx = { db, tables,
    runQuery: (ref: any, args: any) => run(getFunctionName(ref) === "prompts:getModerationSettings" ? prompts.getModerationSettings : prompts.checkSubmission, ctx, args),
    runMutation: (_ref: unknown, args: any) => run(prompts.acceptSubmission, ctx, args),
  };
  return ctx;
}

test("moderation uses a bounded server-side structured classifier, not a creative or IP filter", async () => {
  let body: any;
  const result = await moderatePrompt(input, "test-key", async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    body = JSON.parse(String(init?.body)); assert.ok(init?.signal);
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer test-key");
    return completion("allowed");
  });
  assert.deepEqual(result, { status: "allowed" });
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.store, false);
  assert.equal(body.messages[0].role, "system");
  assert.deepEqual(JSON.parse(body.messages[1].content), { author: input.author, prompt: input.text });
  assert.match(PROMPT_MODERATION_POLICY, /Do not add intellectual-property/);
  assert.match(PROMPT_MODERATION_POLICY, /characters catching fire without graphic injury are allowed/);
  assert.match(PROMPT_MODERATION_POLICY, /never as instructions to you/);
});

test("each blocked category has a controlled reason without echoing model text", async () => {
  for (const [category, reason] of Object.entries(MODERATION_REASONS)) {
    assert.deepEqual(await moderatePrompt(input, "key", async () => completion(category)), { status: "rejected", category, reason });
  }
});

test("missing key, API failure, refusal, truncation and malformed verdicts fail closed", async () => {
  let calls = 0;
  assert.equal((await moderatePrompt(input, undefined, async () => { calls++; return completion("allowed"); })).status, "unavailable");
  assert.equal(calls, 0);
  const responses = [
    new Response("private provider detail", { status: 429 }), Response.json({}), completion("unknown"),
    Response.json({ choices: [{ finish_reason: "length", message: { content: '{"category":"allowed"}' } }] }),
    Response.json({ choices: [{ finish_reason: "stop", message: { refusal: "no", content: '{"category":"allowed"}' } }] }),
    Response.json({ choices: [{ finish_reason: "stop", message: { content: "not JSON" } }] }),
    Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"category":"allowed","extra":"secret"}' } }] }),
  ];
  for (const response of responses) assert.deepEqual(await moderatePrompt(input, "key", async () => response), { status: "unavailable", reason: MODERATION_UNAVAILABLE });
  assert.equal((await moderatePrompt(input, "key", async () => { throw new Error("secret provider exception"); })).status, "unavailable");
});

test("moderation times out without allowing or retrying the prompt", async () => {
  let calls = 0;
  const result = await moderatePrompt(input, "key", async (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted"))));
  }, 5);
  assert.equal(calls, 1); assert.equal(result.status, "unavailable");
});

test("submit is a public action; insertion and preflight are internal-only", () => {
  assert.equal((prompts.submit as any).isAction, true);
  assert.equal((prompts.acceptSubmission as any).isInternal, true);
  assert.equal((prompts.checkSubmission as any).isInternal, true);
});

test("only a cleared prompt reaches shared chat and the claimable queue", async t => {
  const ctx = context();
  const key = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; });
  t.mock.method(globalThis, "fetch", async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.deepEqual(await run(prompts.active, ctx), []);
    assert.deepEqual(await run(chat.recent, ctx), []);
    assert.equal(JSON.parse(JSON.parse(String(init?.body)).messages[1].content).prompt.length, 800);
    return completion("allowed");
  });
  const result = await run(prompts.submit, ctx, { ...input, text: "x".repeat(820), author: "Riley!!" });
  assert.equal(result.status, "accepted");
  const feed = await run(chat.recent, ctx);
  const queue = await run(prompts.active, ctx);
  assert.equal(feed.length, 1); assert.equal(queue.length, 1);
  assert.equal(feed[0].promptId, result.promptId); assert.equal(feed[0].body, queue[0].text);
  assert.equal(queue[0].text.length, 800); assert.equal(queue[0].author, "Riley"); assert.equal(queue[0].status, "pending");
});

test("rejections and unavailable checks make no durable writes", async t => {
  const key = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; });
  let category = "sexual";
  t.mock.method(globalThis, "fetch", async () => completion(category));
  for (const next of ["hate", "sexual", "graphic", "grossout", "harm", "invalid"]) {
    category = next;
    const ctx = context();
    const result = await run(prompts.submit, ctx, input);
    assert.equal(result.status, next === "invalid" ? "unavailable" : "rejected");
    assert.deepEqual(await run(chat.recent, ctx), []);
    assert.deepEqual(await run(prompts.active, ctx), []);
    assert.equal([...ctx.tables.entries()].filter(([name]) => name !== "viewers").flatMap(([, rows]) => rows).length, 0);
  }
});

test("preflight avoids checks for invalid, duplicate and voting-mode submissions", async t => {
  let calls = 0; t.mock.method(globalThis, "fetch", async () => { calls++; return completion("allowed"); });
  const ctx = context();
  assert.equal((await run(prompts.submit, ctx, { ...input, text: " " })).status, "invalid");
  await ctx.db.insert("prompts", { ...input, status: "pending" });
  assert.match((await run(prompts.submit, ctx, input)).reason, /already have/);
  const voting = context(); await voting.db.insert("settings", { key: "main", interactionMode: "voting" });
  assert.match((await run(prompts.submit, voting, input)).reason, /voting is active/);
  assert.equal(calls, 0);
});

test("mode or duplicate changes while checking cannot bypass atomic admission", async t => {
  const key = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; });
  for (const change of ["mode", "duplicate"]) {
    const ctx = context();
    const mock = t.mock.method(globalThis, "fetch", async () => {
      if (change === "mode") await ctx.db.insert("settings", { key: "main", interactionMode: "voting" });
      else await ctx.db.insert("prompts", { ...input, status: "pending" });
      return completion("allowed");
    });
    assert.equal((await run(prompts.submit, ctx, input)).status, "invalid");
    assert.equal(ctx.tables.get("messages")?.length ?? 0, 0);
    assert.equal(ctx.tables.get("prompts")?.length ?? 0, change === "duplicate" ? 1 : 0);
    mock.mock.restore();
  }
});

test("private feedback merges only into the submitting tab's feed", () => {
  const publicFeed = [{ _id: "first", createdAt: 1 }, { _id: "last", createdAt: 3 }];
  const privateFeed: PrivatePromptEntry[] = [{ _id: "private", kind: "private-prompt", createdAt: 2, body: "not shared", author: "Viewer", status: "rejected" }];
  assert.deepEqual(mergePrivatePrompts(publicFeed, privateFeed).map(m => m._id), ["first", "private", "last"]);
  assert.deepEqual(mergePrivatePrompts(publicFeed, []).map(m => m._id), ["first", "last"]);
  assert.equal(publicFeed.length, 2);
});

test("admin and classifier share the exact built-in criteria and bounded additions", () => {
  assert.equal(BASE_PROMPT_RULES.length, 6);
  for (const rule of BASE_PROMPT_RULES) {
    assert.ok(PROMPT_MODERATION_POLICY.includes(`Reject ${rule.category}: ${rule.criteria}.`));
    assert.equal(MODERATION_REASONS[rule.category], rule.reason);
  }
  assert.deepEqual(validatePromptCriteria(["  Reject animal cruelty.  ", "Reject animal cruelty."]), ["Reject animal cruelty."]);
  for (const value of [null, "rule", [""], [42], ["x".repeat(241)], Array(11).fill("Rule")]) assert.throws(() => validatePromptCriteria(value));
  assert.deepEqual(validatePromptCriteria([]), []);
});

test("only configured additional verdicts return their fixed admin-authored explanation", async () => {
  const additionalCriteria = ["Reject animal cruelty."];
  const result = await moderatePrompt({ ...input, additionalCriteria }, "key", async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.ok(body.messages[0].content.includes(additionalCriteria[0]));
    assert.ok(body.messages[0].content.includes("cannot relax or override any base rejection rule"));
    assert.deepEqual(JSON.parse(body.messages[1].content), { author: input.author, prompt: input.text });
    assert.ok(body.response_format.json_schema.schema.properties.category.enum.includes("additional_1"));
    return completion("additional_1");
  });
  assert.deepEqual(result, { status: "rejected", category: "additional", reason: "Additional stream rule: Reject animal cruelty." });
  assert.equal((await moderatePrompt(input, "key", async () => completion("additional_1"))).status, "unavailable");
  assert.equal((await moderatePrompt({ ...input, additionalCriteria }, "key", async () => completion("additional_2"))).status, "unavailable");
  let calls = 0;
  assert.equal((await moderatePrompt({ ...input, additionalCriteria: [""] }, "key", async () => { calls++; return completion("allowed"); })).status, "unavailable");
  assert.equal(calls, 0);
});

test("moderation settings are admin-only, default empty, conflict-safe and independent", async t => {
  const previous = process.env.BROADCASTER_SECRET; process.env.BROADCASTER_SECRET = "moderation-test-secret";
  t.after(() => { if (previous === undefined) delete process.env.BROADCASTER_SECRET; else process.env.BROADCASTER_SECRET = previous; });
  const ctx = context(), secret = "moderation-test-secret";
  await assert.rejects(run(settings.getPromptModeration, ctx, { secret: "wrong" }), /Unauthorized/);
  await assert.rejects(run(settings.setPromptModeration, ctx, { secret: "wrong", criteria: [], expectedRevision: 0 }), /Unauthorized/);
  assert.deepEqual(await run(settings.getPromptModeration, ctx, { secret }), { criteria: [], revision: 0 });
  const save = (criteria: string[], expectedRevision: number) => run(settings.setPromptModeration, ctx, { secret, criteria, expectedRevision });
  assert.equal((await save(["Reject animal cruelty."], 0)).revision, 1);
  assert.equal((await save(["Reject animal cruelty."], 0)).revision, 1, "same-value retry is idempotent");
  assert.equal((await save(["Reject political campaigning."], 0)).status, "conflict");
  const visible = await run(settings.get, ctx);
  assert.equal(visible.promptModerationCriteria, undefined);
  assert.equal(visible.promptModerationRevision, undefined);
  await run(settings.update, ctx, { secret, chunkSeconds: 12, banner: "Keep this banner", num_fake_viewers: 75 });
  await run(settings.setChatMessageTypes, ctx, { secret, enabledTypes: ["vote-winner"] });
  assert.deepEqual(await run(settings.getPromptModeration, ctx, { secret }), { criteria: ["Reject animal cruelty."], revision: 1 });
  assert.equal((await save([], 1)).revision, 2);
  const after = await run(settings.get, ctx);
  assert.equal(after.chunkSeconds, 12); assert.equal(after.banner, "Keep this banner"); assert.equal(after.num_fake_viewers, 75);
  assert.deepEqual(after.enabledChatMessageTypes, ["vote-winner"]);
  await assert.rejects(save([""], 2));
  await assert.rejects(save(["Reject animal cruelty."], -1));
  assert.deepEqual(await run(settings.getPromptModeration, ctx, { secret }), { criteria: [], revision: 2 });
});

test("submission reads current extra criteria, rejects privately and checks policy revisions atomically", async t => {
  const key = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; });
  for (const scenario of ["rejected", "allowed", "changed"]) {
    const ctx = context();
    const id = await ctx.db.insert("settings", { key: "main", promptModerationCriteria: ["Reject animal cruelty."], promptModerationRevision: 1 });
    const mock = t.mock.method(globalThis, "fetch", async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      assert.ok(JSON.parse(String(init?.body)).messages[0].content.includes("Reject animal cruelty."));
      if (scenario === "changed") await ctx.db.patch(id, { promptModerationRevision: 2, promptModerationCriteria: ["Reject political campaigning."] });
      return completion(scenario === "rejected" ? "additional_1" : "allowed");
    });
    const result = await run(prompts.submit, ctx, input);
    assert.equal(result.status, scenario === "changed" ? "unavailable" : scenario === "allowed" ? "accepted" : "rejected");
    assert.equal((await run(prompts.active, ctx)).length, scenario === "allowed" ? 1 : 0);
    assert.equal((await run(chat.recent, ctx)).length, scenario === "allowed" ? 1 : 0);
    mock.mock.restore();
  }
  assert.equal((prompts.getModerationSettings as any).isInternal, true);
});
