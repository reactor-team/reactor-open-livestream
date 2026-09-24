import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { getBackend, isLocalBackend } from "@/lib/backend";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function allowed() {
  return await isAdminAuthenticated() || await isLocalBackend();
}
async function connection() {
  const { convexUrl: url, secret } = await getBackend();
  if (!url || !secret) throw new Error("Programming is not configured");
  return { client: new ConvexHttpClient(url), secret };
}
async function snapshot() {
  const { client, secret } = await connection();
  const [segments, schedule] = await Promise.all([
    client.query(anyApi.segments.list, { secret }), client.query(anyApi.schedule.list, { secret }),
  ]);
  return { segments: segments.map((segment: Record<string, unknown>) => ({ ...segment, persisted: true })), schedule };
}
export async function GET() {
  if (!await allowed()) return Response.json({ error: "Sign in to Admin to access the segment library" }, { status: 401 });
  try { return Response.json(await snapshot(), { headers: { "cache-control": "no-store" } }); }
  catch { return Response.json({ error: "Could not load programming from Convex" }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!await allowed()) return Response.json({ error: "Sign in to Admin to edit programming" }, { status: 401 });
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const { client, secret } = await connection();
  let uploaded: string | undefined;
  let savedId: string | undefined;
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("Expected JSON");
    const raw = await request.text();
    if (raw.length > 8 * 1024 * 1024) throw new Error("Opening frame is too large");
    const input = JSON.parse(raw);
    if (input.operation === "save") {
      const draft = input.draft;
      if (!draft || typeof draft.id !== "string") throw new Error("Invalid segment");
      const fields: Record<string, string> = {};
      for (const key of ["title", "direction", "continuity", "voicePrompt", "experience", "imageAnalysis", "generationModel"]) {
        if (typeof draft[key] !== "string") throw new Error("Invalid segment fields");
        fields[key] = draft[key];
      }
      let openingFrame = null;
      if (draft.openingFrame) {
        const frame = draft.openingFrame;
        let storageId = frame.storageId;
        if (!storageId) {
          const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(frame.dataUrl);
          if (!match) throw new Error("Attach a JPEG, PNG, or WebP image");
          const bytes = Buffer.from(match[2], "base64");
          if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error("Opening frame must be under 5 MB");
          const uploadUrl = await client.mutation(anyApi.prompts.createOpeningFrameUpload, { secret });
          const response = await fetch(uploadUrl, { method: "POST", headers: { "content-type": match[1] }, body: new Blob([Uint8Array.from(bytes)], { type: match[1] }) });
          const result = await response.json();
          if (!response.ok || typeof result.storageId !== "string") throw new Error("Could not store opening frame");
          uploaded = storageId = result.storageId;
        }
        openingFrame = { storageId, name: frame.name, bytes: frame.bytes, width: frame.width, height: frame.height };
      }
      savedId = await client.mutation(anyApi.segments.save, {
        secret, id: draft.persisted ? draft.id : undefined, clientKey: draft.id, ...fields, openingFrame, chunkSeconds: draft.chunkSeconds ?? null,
      });
      uploaded = undefined;
    } else if (input.operation === "schedule") {
      const { operation, id, segmentId, durationSeconds, enabled } = input.edit ?? {};
      await client.mutation(anyApi.schedule.edit, { secret, operation, id, segmentId, durationSeconds, enabled });
    } else throw new Error("Unknown programming action");
    return Response.json({ ...await snapshot(), savedId });
  } catch {
    if (uploaded) await client.mutation(anyApi.prompts.deleteOpeningFrame, { secret, id: uploaded }).catch(() => undefined);
    return Response.json({ error: "Could not save. Check field limits, opening frame (5 MB), and schedule duration (30 to 3600 seconds)." }, { status: 400 });
  }
}
