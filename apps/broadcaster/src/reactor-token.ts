import type { BroadcasterConfig } from "./config";

export async function mintReactorToken(config: BroadcasterConfig, sessionId?: string): Promise<string> {
  if (config.REACTOR_LOCAL) return "";
  const response = await fetch(`${config.REACTOR_API_URL.replace(/\/$/, "")}/tokens`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "Content-Type": "application/json",
      "Reactor-API-Key": config.REACTOR_API_KEY ?? "",
    },
    body: JSON.stringify({
      authorization_details: [
        {
          type: "session",
          resources: {
            models: { match: [config.REACTOR_MODEL] },
            ...(sessionId ? { sessions: { bind: [sessionId] } } : {}),
          },
          ...(!sessionId ? { constraints: { max_sessions: 1 } } : {}),
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Reactor token request failed with HTTP ${response.status}`);
  const payload = (await response.json()) as { jwt?: string };
  if (!payload.jwt) throw new Error("Reactor token response did not contain a JWT");
  return payload.jwt;
}

/** The coordinator verifies signatures; exp is read only to schedule renewal. */
function expiresAt(jwt: string): number {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")) as { exp?: unknown };
    if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) return payload.exp * 1000;
  } catch { /* Never include a credential or decoder error in diagnostics. */ }
  throw new Error("Reactor token response has no valid expiry");
}

/** One bridge, one session. Concurrent SDK requests share the same refresh. */
export function createReactorTokenProvider(config: BroadcasterConfig, {
  mint = (sessionId?: string) => mintReactorToken(config, sessionId),
  now = Date.now,
}: { mint?: (sessionId?: string) => Promise<string>; now?: () => number } = {}) {
  let boundSession: string | undefined;
  const cached = new Map<string, { jwt: string; refreshAt: number }>();
  const pending = new Map<string, Promise<string>>();
  return {
    async get(sessionId?: string, force = false): Promise<string> {
      if (config.REACTOR_LOCAL) return "";
      if (sessionId !== undefined) {
        if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId)) throw new Error("Invalid Reactor session identity");
        if (boundSession && sessionId !== boundSession) throw new Error("Reactor session changed; replace the bridge");
        boundSession = sessionId;
        cached.delete("create");
      }
      const scope = boundSession ?? "create";
      const inFlight = pending.get(scope);
      if (inFlight) return inFlight;
      const token = cached.get(scope);
      if (!force && token && now() < token.refreshAt) return token.jwt;
      cached.delete(scope);
      const refresh = (async () => {
        const jwt = await mint(boundSession);
        const expiry = expiresAt(jwt);
        if (expiry <= now() + 5_000) throw new Error("Reactor returned an expired or imminently expiring token");
        cached.set(scope, { jwt, refreshAt: expiry - 60_000 });
        return jwt;
      })();
      pending.set(scope, refresh);
      try { return await refresh; }
      finally { pending.delete(scope); }
    },
  };
}
