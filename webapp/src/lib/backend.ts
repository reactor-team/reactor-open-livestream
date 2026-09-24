import "server-only";
import { cookies, headers } from "next/headers";
import { BACKEND_COOKIE, resolveBackend } from "./backend-config";

export async function getBackend() {
  const selection = process.env.NODE_ENV === "development" ? (await cookies()).get(BACKEND_COOKIE)?.value : undefined;
  const backend = resolveBackend(selection, {
    ...process.env,
    // Convex deploy supplies this public value to next build, not the server runtime.
    // Keep a direct reference so Next.js can inline it; CONVEX_URL stays runtime-first.
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
  });
  if (backend.switchable) {
    const expected = (await headers()).get("x-reactor-backend");
    if (expected && expected !== backend.target) throw new Error("Backend changed. Reload before continuing.");
  }
  return backend;
}

export async function isLocalBackend() {
  return process.env.NODE_ENV === "development" && (await getBackend()).target === "local";
}
