import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";

test("chat visibility action requires admin auth and a matching backend, and forwards only explicit types", async () => {
  let authorized = false;
  const calls: Array<{ ref: string; args: Record<string, unknown> }> = [];
  const bundled = await build({ entryPoints: ["../../webapp/src/app/admin/actions.ts"], bundle: true, write: false, platform: "node", format: "cjs", plugins: [{ name: "mock-chat-admin", setup(builder) {
    builder.onResolve({ filter: /^(?:@\/lib\/(?:admin-auth|backend)|convex\/browser|convex\/server|next\/(?:cache|navigation))$/ }, args => ({ path: args.path, namespace: "mock" }));
    builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export const { isAdminAuthenticated, getBackend, ConvexHttpClient, anyApi, revalidatePath, redirect, clearAdminSession, isAdminPassword, setAdminSession } = globalThis.mocks;" }));
  } }] });
  const module = { exports: {} as { saveChatMessageSettings: (state: object, form: FormData) => Promise<{ error?: string; success?: string }> } };
  runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports,
    mocks: { isAdminAuthenticated: async () => authorized,
      getBackend: async () => ({ convexUrl: "https://fixture.convex.cloud", secret: "server-fixture-secret", target: "staging", switchable: true }),
      revalidatePath() {}, anyApi: { settings: { setChatMessageTypes: "settings:setChatMessageTypes" } },
      ConvexHttpClient: class { async mutation(ref: string, args: Record<string, unknown>) { calls.push({ ref, args }); } },
    },
  });
  const save = (types: string[], backend = "staging") => {
    const form = new FormData(); form.set("backend", backend); form.set("secret", "viewer-forgery");
    form.set("interactionMode", "prompts");
    for (const type of types) form.append("enabledTypes", type);
    return module.exports.saveChatMessageSettings({}, form);
  };
  assert.match((await save(["vote-winner"])).error!, /session/);
  authorized = true;
  assert.match((await save(["vote-winner"], "local")).error!, /Backend changed/);
  assert.match((await save(["unknown"])).error!, /Unknown/);
  assert.equal(calls.length, 0);
  assert.match((await save(["vote-winner"])).success!, /all viewers/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { ref: "settings:setChatMessageTypes", args: { secret: "server-fixture-secret", enabledTypes: ["vote-winner"] } });
  assert.match((await save([])).success!, /All Reactor TV notices are hidden/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].args.enabledTypes)), []);
});
