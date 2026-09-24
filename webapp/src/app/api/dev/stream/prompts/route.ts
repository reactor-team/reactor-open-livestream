import { isLocalBackend } from "@/lib/backend";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!await isLocalBackend()) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const base = process.env.LOCAL_BROADCASTER_CONTROL_URL || "http://127.0.0.1:8787";
    const response = await fetch(`${base}/control/prompts`, {
      cache: "no-store", signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("Prompt inspector unavailable");
    return Response.json(await response.json(), { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Local broadcaster unavailable" }, { status: 503 });
  }
}
