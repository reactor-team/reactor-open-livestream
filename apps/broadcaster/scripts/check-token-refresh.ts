/** Opt-in real SDK check. One disposable Reactor session, no generation or LiveKit. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createReactorTokenProvider } from "../src/reactor-token";
import type { BroadcasterConfig } from "../src/config";

if (!process.env.REACTOR_API_KEY) throw new Error("REACTOR_API_KEY is required");
const config = { REACTOR_LOCAL: false, REACTOR_MODEL: "reactor/fast-h3", REACTOR_API_URL: "https://api.reactor.inc", REACTOR_API_KEY: process.env.REACTOR_API_KEY } as BroadcasterConfig;
const tokens = createReactorTokenProvider(config);
let rejectOnce = false, forcedRefreshes = 0;
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
import { Reactor } from "@reactor-team/js-sdk";
import { withUploadAuthRetry } from "./src/upload-auth";
const reactor = new Reactor({ modelName: "reactor/fast-h3", jwt: () => window.getToken(reactor.getSessionId()) });
window.check = async () => {
  let result;
  try {
    await reactor.connect();
    const id = reactor.getSessionId();
    const image = new Blob([Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1kAAAAASUVORK5CYII="), c => c.charCodeAt(0))], {type:"image/png"});
    const first = await reactor.uploadFile(image, { name: "auth-check.png" });
    await window.rejectCredential();
    const second = await withUploadAuthRetry(
      () => reactor.uploadFile(image, { name: "auth-retry.png" }),
      () => window.getToken(reactor.getSessionId(), true),
    );
    result = { sameSession: id === reactor.getSessionId(), uploaded: Boolean(first.uploadId && second.uploadId) };
  } finally { await reactor.disconnect(); }
  return result;
};` }, bundle: true, write: false, format: "esm", platform: "browser" });
const wasm = await readFile("node_modules/@reactor-team/js-sdk/dist/wasm/reactor_wasm_bg.wasm");
const server = createServer((req, res) => {
  if (req.url?.endsWith(".wasm")) { res.writeHead(200, { "content-type": "application/wasm" }); res.end(wasm); }
  else if (req.url === "/check.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(bundle.outputFiles[0].contents); }
  else { res.writeHead(200, { "content-type": "text/html" }); res.end('<script type="module" src="/check.js"></script>'); }
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
const deadline = setTimeout(() => void browser.close(), 180_000);
try {
  const page = await browser.newPage();
  await page.exposeFunction("getToken", async (id?: string, force = false) => {
    if (force) forcedRefreshes++;
    const token = await tokens.get(id, force);
    if (rejectOnce) { rejectOnce = false; return token.split(".").slice(0, 2).join(".") + ".invalid-signature"; }
    return token;
  });
  await page.exposeFunction("rejectCredential", () => { rejectOnce = true; });
  await page.goto(`http://127.0.0.1:${address.port}`);
  const result = await page.evaluate(async () => await (window as unknown as { check: () => Promise<{ sameSession: boolean; uploaded: boolean }> }).check());
  assert.equal(result.sameSession, true);
  assert.equal(result.uploaded, true);
  assert.equal(forcedRefreshes, 1);
  console.log("PASS: real SDK recovered one rejected upload with a fresh session-bound token; same session, two uploads, no generation; session disconnected.");
} finally {
  clearTimeout(deadline);
  await browser.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
