export const BACKEND_COOKIE = "reactor_tv_backend";
export type BackendTarget = "local" | "staging" | "deployment";
export type PublicBackend = { target: BackendTarget; convexUrl: string; switchable: boolean; stagingAvailable: boolean };

function secureOrigin(value: string | undefined, name: string): string {
  if (!value) throw new Error(name + " is not configured");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(name + " must be an HTTPS origin");
  }
  return url.origin;
}

// Only operator-configured endpoints can receive server credentials.
export function resolveBackend(selection: string | undefined, env: Record<string, string | undefined>) {
  const switchable = env.NODE_ENV === "development";
  const target: BackendTarget = switchable ? selection === "staging" ? "staging" : "local" : "deployment";
  const stagingAvailable = switchable && Boolean(env.DEV_REMOTE_CONVEX_URL && env.DEV_REMOTE_SITE_URL);
  const deploymentUrl = env.CONVEX_URL || env.NEXT_PUBLIC_CONVEX_URL;
  if (target === "deployment" && !deploymentUrl) throw new Error("Convex is not configured for this deployment");
  const convexUrl = target === "staging"
    ? secureOrigin(env.DEV_REMOTE_CONVEX_URL, "DEV_REMOTE_CONVEX_URL")
    : deploymentUrl || "http://127.0.0.1:3210";
  const remoteSiteUrl = target === "staging" ? secureOrigin(env.DEV_REMOTE_SITE_URL, "DEV_REMOTE_SITE_URL") : undefined;
  const secret = target === "staging" ? env.DEV_REMOTE_BROADCASTER_SECRET : env.BROADCASTER_SECRET;
  return { target, convexUrl, switchable, stagingAvailable, remoteSiteUrl, secret };
}

export function publicBackend(backend: ReturnType<typeof resolveBackend>): PublicBackend {
  const { target, convexUrl, switchable, stagingAvailable } = backend;
  return { target, convexUrl, switchable, stagingAvailable };
}
