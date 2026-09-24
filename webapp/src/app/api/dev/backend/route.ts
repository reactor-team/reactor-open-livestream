import { cookies } from "next/headers";
import { BACKEND_COOKIE, resolveBackend } from "@/lib/backend-config";
import { isLocalSameOrigin } from "@/lib/local-request";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") return Response.json({ error: "Not found" }, { status: 404 });
  if (!isLocalSameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const input = await request.json().catch(() => null);
  if (input?.target !== "local" && input?.target !== "staging") return Response.json({ error: "Choose Local or Staging" }, { status: 400 });
  try { resolveBackend(input.target, process.env); }
  catch { return Response.json({ error: "Configure DEV_REMOTE_CONVEX_URL and DEV_REMOTE_SITE_URL in the local server environment." }, { status: 503 }); }
  (await cookies()).set(BACKEND_COOKIE, input.target, { httpOnly: true, sameSite: "strict", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return Response.json({ target: input.target }, { headers: { "cache-control": "no-store" } });
}
