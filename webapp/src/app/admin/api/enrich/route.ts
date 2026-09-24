import { getBackend } from "@/lib/backend";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 200;
const fields = ["title", "experience", "imageAnalysis", "startingPrompt", "continuityNotes", "voicePrompt"];
const limits: Record<string, number> = { title: 80, experience: 1200, imageAnalysis: 1800, startingPrompt: 800, continuityNotes: 1600, voicePrompt: 360, changeRequest: 800, imageDataUrl: 7_000_000 };
function reply(data: object, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}
export async function POST(request: Request) {
  if (!await isAdminAuthenticated()) return reply({ error: "Sign in to Admin to enrich segments" }, 401);
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: "Invalid origin" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "Expected JSON" }, 400);
  const { convexUrl: url, secret } = await getBackend();
  if (!url || !secret) return reply({ error: "Admin AI is not connected to Convex" }, 503);
  let input: Record<string, string | number>;
  try {
    const raw = await request.text();
    if (raw.length > 7_100_000) return reply({ error: "Opening frame must be under 5 MB" }, 413);
    const body = JSON.parse(raw) as Record<string, unknown> | null;
    if (!body || typeof body.field !== "string" || !fields.includes(body.field)) return reply({ error: "Choose a field to enrich" }, 400);
    input = { field: body.field };
    for (const [name, limit] of Object.entries(limits)) {
      if (body[name] === undefined) continue;
      if (typeof body[name] !== "string") return reply({ error: "Invalid enrichment context" }, 400);
      if (name === "imageDataUrl" && body[name].length > limit) return reply({ error: "Opening frame must be under 5 MB" }, 413);
      input[name] = body[name].slice(0, limit);
    }
    if (body.chunkSeconds !== undefined) {
      if (typeof body.chunkSeconds !== "number" || !Number.isInteger(body.chunkSeconds) || body.chunkSeconds < 6 || body.chunkSeconds > 14) return reply({ error: "Chunk length must be 6 to 14 seconds" }, 400);
      input.chunkSeconds = body.chunkSeconds;
    }
  } catch { return reply({ error: "Invalid enrichment request" }, 400); }
  try {
    const result = await new ConvexHttpClient(url).action(anyApi.adminAi.enrich, { secret, input }) as { status: number; data: { value?: string; model?: string; error?: string } };
    return reply(result.data, result.status);
  } catch {
    return reply({ error: "Could not reach Admin AI. Check the Convex deployment and server configuration." }, 503);
  }
}
