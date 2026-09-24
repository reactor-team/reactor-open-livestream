import { cp, mkdir } from "node:fs/promises";

import { build, context, type BuildOptions } from "esbuild";

await mkdir("dist", { recursive: true });
const builds: BuildOptions[] = [{
  entryPoints: ["src/supervisor.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile: "dist/supervisor.js",
  packages: "external",
  sourcemap: true,
}, {
  entryPoints: ["src/server.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile: "dist/server.js",
  packages: "external",
  sourcemap: true,
}, {
  entryPoints: ["src/bridge.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  outfile: "dist/bridge.js",
  sourcemap: true,
}];

if (process.argv.includes("--watch")) {
  const contexts = await Promise.all(builds.map((options) => context(options)));
  await Promise.all(contexts.map((buildContext) => buildContext.watch()));
  console.log("[build] watching broadcaster sources");
} else {
  await Promise.all(builds.map((options) => build(options)));
}
await cp(".env.example", "dist/.env.example");
await cp(
  "node_modules/@reactor-team/js-sdk/dist/wasm/reactor_wasm_bg.wasm",
  "dist/reactor_wasm_bg.wasm",
);
