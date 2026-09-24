import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { readFileSync } from "node:fs";

const root = fileURLToPath(new URL("../", import.meta.url));
const values = {};
for (const name of [".env.local", ".env.development.local"]) {
  const file = resolve(root, "webapp", name);
  if (existsSync(file)) Object.assign(values, parseEnv(readFileSync(file, "utf8")));
}
Object.assign(values, process.env);
const required = ["NEXT_PUBLIC_CONVEX_URL", "ADMIN_PASSWORD", "BROADCASTER_SECRET", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "REACTOR_API_KEY", "CEREBRAS_API_KEY"];
let failed = false;
for (const name of required) {
  const present = Boolean(values[name]?.trim());
  console.log(`${name}: ${present ? "configured" : "missing"}`);
  if (!present) failed = true;
}
if (values.BROADCASTER_SECRET && values.BROADCASTER_SECRET.length < 32) {
  console.log("BROADCASTER_SECRET: use at least 32 random characters"); failed = true;
}
console.log("Also configure matching BROADCASTER_SECRET and OPENAI_API_KEY in your selected Convex deployment. This check cannot verify backend secrets or provider access.");
console.log("Viewer: http://localhost:3000 | Admin: http://localhost:3000/admin");
process.exitCode = failed ? 1 : 0;
