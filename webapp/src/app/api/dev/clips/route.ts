import { CLIP_UPLOAD_BYTES } from "@/lib/clip-range";
import { exportLocalClip } from "@/lib/local-clip-export";
import { isLocalSameOrigin } from "@/lib/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let running = false;

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") return new Response(null, { status: 404 });
  if (!isLocalSameOrigin(request)) return new Response(null, { status: 403 });
  if (running) return Response.json({ error: "Another clip is exporting. Try again in a moment." }, { status: 429 });
  if (!request.body) return new Response(null, { status: 400 });
  running = true;
  try {
    const reader = request.body.getReader();
    const pieces: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > CLIP_UPLOAD_BYTES + 64 * 1024) { await reader.cancel(); return Response.json({ error: "This clip exceeds the 72 MB local limit." }, { status: 413 }); }
      pieces.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const piece of pieces) { body.set(piece, offset); offset += piece.byteLength; }
    const form = await new Response(body, { headers: { "content-type": request.headers.get("content-type") || "" } }).formData();
    const files = form.getAll("video");
    if (!files.every(file => file instanceof File)) return new Response(null, { status: 400 });
    const start = form.get("start");
    const end = form.get("end");
    const range = start === null && end === null ? undefined : { start: Number(start), end: Number(end) };
    const result = await exportLocalClip(files, range, request.signal);
    return new Response(new Uint8Array(result), { headers: { "content-type": "video/mp4", "cache-control": "no-store" } });
  } catch (error) {
    const known = error instanceof Error && /^(Choose|This video|Capture at most)/.test(error.message);
    return Response.json({ error: known ? error.message : "Couldn't prepare this clip. Try another moment. Local clipping requires FFmpeg." }, { status: 422 });
  } finally { running = false; }
}
