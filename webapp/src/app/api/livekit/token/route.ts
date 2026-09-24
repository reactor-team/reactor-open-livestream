import { getBackend } from "@/lib/backend";
import { NextRequest } from "next/server";
import { AccessToken } from "livekit-server-sdk";

import { DEFAULT_DEV_LIVEKIT_ROOM, DEFAULT_LIVEKIT_ROOM } from "@reactor/infinite-contracts";

export const dynamic = "force-dynamic";

function unavailable(detail: string): Response {
  console.error(`/api/livekit/token: ${detail}`);
  return Response.json(
    { error: "The stream is not available right now." },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  const backend = await getBackend();
  if (backend.target === "staging") {
    try {
      const tokenUrl = new URL("/api/livekit/token", backend.remoteSiteUrl);
      const identity = request.nextUrl.searchParams.get("identity") ?? "";
      if (/^[a-f0-9]{12,32}$/.test(identity)) tokenUrl.searchParams.set("identity", identity);
      // This is a public, subscribe-only endpoint. Never forward cookies or credentials.
      const response = await fetch(tokenUrl, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return unavailable("Staging token endpoint unavailable");
      const data = await response.json();
      if (typeof data.url !== "string" || !data.url.startsWith("wss://") || typeof data.token !== "string") return unavailable("Invalid staging token response");
      return Response.json({ url: data.url, token: data.token }, { headers: { "cache-control": "no-store" } });
    } catch { return unavailable("Could not connect to staging"); }
  }
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) return unavailable("LiveKit configuration is incomplete");

  const requestedIdentity = request.nextUrl.searchParams.get("identity") ?? "";
  const identity = /^[a-f0-9]{12,32}$/.test(requestedIdentity)
    ? requestedIdentity
    : crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const defaultRoom = process.env.NODE_ENV === "development" ? DEFAULT_DEV_LIVEKIT_ROOM : DEFAULT_LIVEKIT_ROOM;
  const room = process.env.LIVEKIT_ROOM || defaultRoom;
  const token = new AccessToken(apiKey, apiSecret, { identity: `viewer-${identity}`, ttl: "1h" });
  token.addGrant({ room, roomJoin: true, canPublish: false, canPublishData: false, canSubscribe: true });

  return Response.json(
    { url, token: await token.toJwt() },
    { headers: { "cache-control": "no-store" } },
  );
}
