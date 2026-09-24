import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { DEFAULT_BROADCAST_SETTINGS, displayedViewerCount, isValidFakeViewerCount } from "@reactor/infinite-contracts";

test("displayed viewers react to both settings and presence without replacing the actual count", () => {
  assert.equal(displayedViewerCount(2, undefined), undefined, "Wait for configured settings instead of flashing a default");
  assert.equal(displayedViewerCount(2, {}), 2, "Older backends use the default");
  assert.equal(displayedViewerCount(0, DEFAULT_BROADCAST_SETTINGS), 0);
  assert.equal(displayedViewerCount(2, { num_fake_viewers: 50 }), 52);
  assert.equal(displayedViewerCount(3, { num_fake_viewers: 50 }), 53);
  assert.equal(displayedViewerCount(3, { num_fake_viewers: 100 }), 103);
  assert.equal(displayedViewerCount(3, { num_fake_viewers: 0 }), 3);
  for (const value of [-1, 0.5, NaN, Infinity, 1_000_001, "50", null, undefined]) assert.equal(isValidFakeViewerCount(value), false);
  for (const value of [0, 50, 1_000_000]) assert.equal(isValidFakeViewerCount(value), true);
});

test("the admin action authenticates, validates the offset, and uses the selected server credential", async () => {
  let authorized = false;
  const calls: Array<{ ref: string; args: Record<string, unknown> }> = [];
  const bundled = await build({ entryPoints: ["../../webapp/src/app/admin/actions.ts"], bundle: true, write: false, platform: "node", format: "cjs", plugins: [{ name: "mock-viewer-admin", setup(builder) {
    builder.onResolve({ filter: /^(?:@\/lib\/(?:admin-auth|backend)|convex\/browser|convex\/server|next\/(?:cache|navigation))$/ }, args => ({ path: args.path, namespace: "mock" }));
    builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export const { isAdminAuthenticated, getBackend, ConvexHttpClient, anyApi, revalidatePath, redirect, clearAdminSession, isAdminPassword, setAdminSession } = globalThis.mocks;" }));
  } }] });
  const module = { exports: {} as { saveSettings: (state: object, form: FormData) => Promise<{ error?: string; success?: string }> } };
  runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports,
    mocks: { isAdminAuthenticated: async () => authorized,
      getBackend: async () => ({ convexUrl: "https://fixture.convex.cloud", secret: "server-fixture-secret", target: "local", switchable: true }),
      revalidatePath() {}, anyApi: { settings: { update: "settings:update" } },
      ConvexHttpClient: class { async mutation(ref: string, args: Record<string, unknown>) { calls.push({ ref, args }); } },
    },
  });
  const save = (value: string | Blob | undefined, backend = "local") => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ backend, secret: "viewer-forgery", chunkSeconds: "10", interactionMode: "prompts", voteDurationChunks: "2", banner: "" })) form.set(key, value);
    if (value !== undefined) form.set("num_fake_viewers", value);
    return module.exports.saveSettings({}, form);
  };
  assert.match((await save("50")).error!, /session/);
  authorized = true;
  assert.match((await save("50", "staging")).error!, /Backend changed/);
  for (const value of ["", " ", "-1", "0.5", "Infinity", "wat", "1000001", new Blob(["50"])]) assert.match((await save(value)).error!, /num_fake_viewers/);
  assert.equal(calls.length, 0);
  for (const value of ["50", "0", "1000000", undefined]) {
    assert.ok((await save(value)).success);
    assert.equal(calls.at(-1)?.args.num_fake_viewers, value === undefined ? undefined : Number(value));
    assert.equal(calls.at(-1)?.args.secret, "server-fixture-secret");
    assert.equal(calls.at(-1)?.ref, "settings:update");
  }
});

test("the admin number control shows its saved value with a default of 0 and explains zero", async () => {
  const require = createRequire(resolve("../../webapp/package.json"));
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const built = await build({ entryPoints: ["../../webapp/src/app/admin/settings-form.tsx"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", plugins: [{ name: "mock-settings-ui", setup(builder) {
    builder.onResolve({ filter: /^(?:\.\.\/backend-context|\.\/actions)$/ }, args => ({ path: args.path, namespace: "mock" }));
    builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export const useBackend = () => ({target:'local'}); export const saveSettings = async () => ({});" }));
  } }] });
  const module = { exports: {} as { default: unknown } };
  new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
  for (const value of [undefined, 0, 75]) {
    const html = renderToStaticMarkup(createElement(module.exports.default, { settings: { ...DEFAULT_BROADCAST_SETTINGS, num_fake_viewers: value } }));
    assert.match(html, /<label for="num-fake-viewers">/);
    assert.match(html, /Set to 0 to show only actual viewers/);
    const input = html.match(/<input id="num-fake-viewers"[^>]*>/)?.[0] ?? "";
    for (const attribute of ['name="num_fake_viewers"', 'type="number"', 'min="0"', 'max="1000000"', 'step="1"', 'required=""', `value="${value ?? 0}"`]) assert.ok(input.includes(attribute), attribute);
  }
});
