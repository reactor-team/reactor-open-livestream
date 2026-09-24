import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { BASE_PROMPT_RULES } from "../../../webapp/convex/lib/promptModerationPolicy";

test("moderation save authenticates, validates and isolates backend writes", async () => {
  let authorized = false, target = "staging", secret: string | undefined = "server-fixture-secret", conflict = false, fail = false;
  const calls: Array<Record<string, unknown>> = [];
  const built = await build({ entryPoints: ["../../webapp/src/app/admin/actions.ts"], bundle: true, write: false, platform: "node", format: "cjs", plugins: [{ name: "mock-moderation-admin", setup(builder) {
    builder.onResolve({ filter: /^(?:@\/lib\/(?:admin-auth|backend)|convex\/browser|convex\/server|next\/(?:cache|navigation))$/ }, args => ({ path: args.path, namespace: "mock" }));
    builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export const { isAdminAuthenticated, getBackend, ConvexHttpClient, anyApi, revalidatePath, redirect, clearAdminSession, isAdminPassword, setAdminSession } = globalThis.mocks;" }));
  } }] });
  const module = { exports: {} as { savePromptModeration: (state: object, form: FormData) => Promise<{ error?: string; success?: string; revision: number }> } };
  runInNewContext(built.outputFiles[0].text, { module, exports: module.exports, mocks: {
    isAdminAuthenticated: async () => authorized,
    getBackend: async () => ({ convexUrl: "https://fixture.convex.cloud", secret, target, switchable: true }),
    revalidatePath() {}, anyApi: { settings: { setPromptModeration: "settings:setPromptModeration" } },
    ConvexHttpClient: class { async mutation(ref: string, args: Record<string, unknown>) {
      if (fail) throw new Error("private provider credential");
      calls.push({ ref, args }); return conflict ? { status: "conflict" } : { status: "saved", revision: 3 };
    } },
  } });
  const save = (criteria: string[], revision = "2") => {
    const form = new FormData(); form.set("backend", "staging"); form.set("revision", revision); form.set("secret", "forged-secret"); form.set("chunkSeconds", "14");
    criteria.forEach(rule => form.append("criteria", rule));
    return module.exports.savePromptModeration({ revision: 2 }, form);
  };
  assert.match((await save(["Reject animal cruelty."])).error!, /session/);
  authorized = true; target = "local";
  assert.match((await save(["Reject animal cruelty."])).error!, /Backend changed/);
  target = "staging"; secret = undefined;
  assert.match((await save([])).error!, /credential/);
  secret = "server-fixture-secret";
  for (const criteria of [[""], ["x".repeat(241)], Array(11).fill("rule")]) assert.ok((await save(criteria)).error);
  for (const revision of ["", "-1", "NaN", "1.2"]) assert.ok((await save([], revision)).error);
  assert.equal(calls.length, 0);
  assert.match((await save(["  Reject animal cruelty.  "])).success!, /immediately/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { ref: "settings:setPromptModeration", args: { secret: "server-fixture-secret", criteria: ["Reject animal cruelty."], expectedRevision: 2 } });
  conflict = true;
  assert.match((await save([])).error!, /Another admin/);
  conflict = false; fail = true;
  assert.doesNotMatch((await save([])).error!, /private provider/);
});

test("Admin displays every base rule, saved additions and a safe unavailable state", async () => {
  const require = createRequire(resolve("../../webapp/package.json"));
  const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
  const built = await build({ entryPoints: ["../../webapp/src/app/admin/prompt-moderation-settings.tsx"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", plugins: [{ name: "admin-form-fixtures", setup(builder) {
    builder.onResolve({ filter: /^\.\/actions$/ }, args => ({ path: args.path, namespace: "actions" }));
    builder.onLoad({ filter: /.*/, namespace: "actions" }, () => ({ contents: "export async function savePromptModeration(state) { return state; }" }));
    builder.onResolve({ filter: /^\.\.\/backend-context$/ }, args => ({ path: args.path, namespace: "backend" }));
    builder.onLoad({ filter: /.*/, namespace: "backend" }, () => ({ contents: "export function useBackend() { return { target: 'local' }; }" }));
  } }] });
  const module = { exports: {} as { default: unknown } };
  new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
  const render = (settings: unknown) => renderToStaticMarkup(createElement(module.exports.default, { settings })) as string;
  const base = render({ criteria: [], revision: 0 });
  for (const rule of BASE_PROMPT_RULES) assert.ok(base.includes(rule.title) && base.includes(rule.criteria));
  assert.match(base, /Always on/); assert.match(base, /Allowed by default/);
  assert.match(base, /No additional criteria/); assert.match(base, /Save prompt moderation/);
  const extra = render({ criteria: ["Reject animal cruelty."], revision: 7 });
  assert.match(extra, /name="revision" value="7"/);
  assert.match(extra, /name="criteria"[^>]*>Reject animal cruelty\./);
  assert.match(extra, /Remove criterion 1/);
  const missing = render(null);
  assert.match(missing, /Saved criteria could not be loaded/);
  assert.match(missing, /<fieldset[^>]*disabled/);
  assert.match(missing, /<button disabled="" type="submit">Save prompt moderation/);
});
