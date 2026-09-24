import { ConvexHttpClient } from "convex/browser";
import { getBackend } from "@/lib/backend";
import { anyApi } from "convex/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type QueueRequest = {
  chunkSeconds?: unknown;
  action?: unknown;
  continuous?: unknown;
  author?: unknown;
  continuityNotes?: unknown;
  voicePrompt?: unknown;
  identity?: unknown;
  imageDataUrl?: unknown;
  text?: unknown;
  preset?: unknown;
};

function isDevSurface(): boolean {
  return process.env.NODE_ENV === "development" || process.env.VERCEL_ENV === "preview";
}

function unavailable(): Response {
  return Response.json({ error: "Not found" }, { status: 404 });
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const uncaught = /Uncaught Error:\s*([^\n]+)/.exec(message)?.[1];
  return (uncaught || message.split("\n")[0] || "Could not queue segment")
    .replace(/[\u2013\u2014]/g, "-")
    .slice(0, 280);
}

function decodeImage(value: unknown): { bytes: Buffer; mediaType: string } | null {
  if (typeof value !== "string") return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i.exec(value);
  if (!match) throw new Error("Attach a JPEG, PNG, or WebP opening frame");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("The prepared opening frame is too large");
  return { bytes, mediaType: match[1] };
}

export async function POST(request: Request): Promise<Response> {
  if (!isDevSurface()) return unavailable();
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const backend = await getBackend();
  if (backend.target === "staging") return Response.json({ error: "Use Admin to edit the staging schedule. Direct workshop overrides are local-only." }, { status: 403 });
  const secret = backend.secret;
  if (!secret) return Response.json({ error: "Segment queue is not configured" }, { status: 503 });

  const input = (await request.json().catch(() => null)) as QueueRequest | null;
  if (input?.preset !== undefined) return Response.json({ error: "Create your own segment in the workshop" }, { status: 400 });
  const text = typeof input?.text === "string" ? input.text : "";
  const author = typeof input?.author === "string" ? input.author : "";
  const identity = typeof input?.identity === "string" ? input.identity : "";
  const continuityNotes = typeof input?.continuityNotes === "string" ? input.continuityNotes : undefined;
  const voicePrompt = typeof input?.voicePrompt === "string" ? input.voicePrompt : undefined;
  const action = input?.action === "play" ? "play" : "queue";
  let openingFrameId: string | undefined;
  const client = new ConvexHttpClient(backend.convexUrl);

  try {
    const image = decodeImage(input?.imageDataUrl);
    if (image) {
      const uploadUrl = await client.mutation(anyApi.prompts.createOpeningFrameUpload, { secret });
      const upload = await fetch(uploadUrl, {
        method: "POST",
        headers: { "content-type": image.mediaType },
        body: new Blob([Uint8Array.from(image.bytes)], { type: image.mediaType }),
      });
      const result = (await upload.json().catch(() => ({}))) as { storageId?: unknown };
      if (!upload.ok || typeof result.storageId !== "string") throw new Error("Could not upload the opening frame");
      openingFrameId = result.storageId;
    }

    const promptId = await client.mutation(anyApi.prompts.submitSegment, {
      secret,
      text,
      author,
      identity,
      continuityNotes,
      chunkSeconds: input?.chunkSeconds,
      voicePrompt,
      openingFrameId,
      playNow: action === "play",
      continuous: input?.continuous === true,
    });
    return Response.json({ promptId }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (openingFrameId) {
      await client.mutation(anyApi.prompts.deleteOpeningFrame, {
        secret,
        id: openingFrameId,
      }).catch(() => undefined);
    }
    return Response.json({ error: cleanError(error) }, { status: 400 });
  }
}
