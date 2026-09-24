import { isLocalBackend } from "@/lib/backend";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ControlState = {
  active: boolean;
  status: "offline" | "starting" | "live" | "degraded";
  detail: string;
  room: string;
};

function unavailable(): Response {
  return Response.json({ error: "Not found" }, { status: 404 });
}

function controlUrl(path = ""): string {
  const base = process.env.LOCAL_BROADCASTER_CONTROL_URL || "http://127.0.0.1:8787";
  return `${base}/control${path}`;
}

async function forward(path = "", method = "GET"): Promise<Response> {
  try {
    const response = await fetch(controlUrl(path), {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json()) as ControlState | { detail?: string };
    return Response.json(body, {
      status: response.status,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Local broadcaster unavailable";
    return Response.json(
      { active: false, status: "degraded", detail },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function GET(): Promise<Response> {
  if (!await isLocalBackend()) return unavailable();
  return await forward();
}

export async function POST(request: Request): Promise<Response> {
  if (!await isLocalBackend()) return unavailable();
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "start" && body?.action !== "stop" && body?.action !== "keepalive") {
    return Response.json({ error: "Action must be start, stop, or keepalive" }, { status: 400 });
  }
  return await forward(`/${body.action}`, "POST");
}
