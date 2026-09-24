import { v } from "convex/values";

export const OUTAGE_THRESHOLD_MS = 5 * 60_000;
export const RECOVERY_STABILITY_MS = 4000;
export const SAMPLE_MAX_AGE_MS = 5000;
export const DELIVERY_LEASE_MS = 30_000;
export const MAX_DELIVERY_ATTEMPTS = 3;

export const delivery = v.object({
  state: v.union(v.literal("pending"), v.literal("sending"), v.literal("sent"), v.literal("failed")),
  attempts: v.number(),
  attemptedAt: v.optional(v.number()),
  sentAt: v.optional(v.number()),
  errorCode: v.optional(v.string()),
});

export function slackWebhookUrl(value = process.env.SLACK_STREAM_WEBHOOK_URL): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "hooks.slack.com" && !url.port
      && !url.username && !url.password && !url.search && !url.hash
      && /^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname)
      ? url.href : null;
  } catch { return null; }
}

/** Only explicit member IDs can notify people; malformed lists never broaden recipients. */
export function slackAlertUserIds(value = process.env.SLACK_STREAM_ALERT_MENTION): string[] {
  if (!value?.trim() || value.trim() === "none") return [];
  const ids = value.split(",").map(id => id.trim());
  if (ids.length > 10 || ids.some(id => !/^[UW][A-Z0-9]{8,31}$/.test(id))) return [];
  return [...new Set(ids)];
}

export function slackOutageMessage(
  phase: "down" | "recovery",
  incident: { _id: string; startedAt: number; recoveredAt?: number },
  now: number,
  mention = process.env.SLACK_STREAM_ALERT_MENTION,
) {
  const mentions = phase === "down" ? slackAlertUserIds(mention).map(id => `<@${id}>`).join(" ") : "";
  const ping = mentions ? `${mentions} ` : "";
  const duration = Math.max(0, Math.round(((incident.recoveredAt ?? now) - incident.startedAt) / 1000));
  const started = new Date(incident.startedAt).toISOString();
  const headline = phase === "down" ? "Reactor TV stream interrupted" : "Reactor TV stream recovered";
  const detail = phase === "down"
    ? `No confirmed live video progress for ${duration}s.${incident.recoveredAt ? " Video has resumed." : ""}`
    : `Live video is advancing again. Interruption: about ${duration}s.`;
  return {
    text: `${ping}*${headline}*\n${detail}\nSince ${started}\nIncident: ${incident._id}`,
    unfurl_links: false,
    unfurl_media: false,
  };
}

/** Only fixed codes leave this transport. Webhook URLs and response bodies stay private. */
export async function postSlackAlert(url: string, payload: ReturnType<typeof slackOutageMessage>): Promise<{
  ok: boolean; retryable: boolean; errorCode?: string; retryAfterMs?: number;
}> {
  try {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000), redirect: "error",
    });
    if (response.status === 200 && (await response.text()).trim() === "ok") return { ok: true, retryable: false };
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      return { ok: false, retryable: true, errorCode: "slack_rate_limited",
        retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.min(300_000, seconds * 1000) : 30_000 };
    }
    return { ok: false, retryable: response.status >= 500, errorCode: response.status >= 500 ? "slack_unavailable" : "slack_rejected" };
  } catch {
    return { ok: false, retryable: true, errorCode: "slack_network_error" };
  }
}
