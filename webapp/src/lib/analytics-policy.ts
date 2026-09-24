// Public starter: no analytics project or collection is configured.
export const POSTHOG_PROJECT_TOKEN = "";
export const POSTHOG_HOST = "https://us.i.posthog.com";

const schemas = {
  visit_started: {},
  playback_started: { startup_ms: "number" },
  playback_interrupted: { reason: ["connection", "broadcast"] },
  playback_resumed: { interruption_ms: "number" },
  watch_time: { seconds: "number" },
  prompt_submitted: { source: ["player", "chat"] },
  prompt_result: { source: ["player", "chat"], outcome: ["accepted", "rejected", "unavailable", "invalid", "uncertain"], duration_ms: "number" },
  prompt_blocked: { reason: ["connection", "loading", "name_required", "voting", "checking", "active_prompt", "empty", "unavailable"] },
  chat_result: { outcome: ["sent", "failed"] },
  vote_result: { outcome: ["accepted", "failed"] },
  name_saved: {},
  schedule_opened: {},
  sound_changed: { action: ["enable", "mute", "unmute"] },
  fullscreen_result: { outcome: ["entered", "exited", "failed"] },
  cta_clicked: { target: ["fasth3", "learn_more", "yc", "speedrun", "codex", "claude"] },
} as const;

export type StreamEvent = keyof typeof schemas;
export type EventProperties = Record<string, string | number>;

export function analyticsEnabled(hostname: string, pathname: string, production: boolean) {
  void hostname; void pathname; void production;
  return false;
}

export function safeEventProperties(event: StreamEvent, input: Record<string, unknown>): EventProperties {
  const output: EventProperties = {};
  for (const [key, rule] of Object.entries(schemas[event])) {
    const value = input[key];
    if (rule === "number") {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) output[key] = Math.min(value, 86_400_000);
    } else if (typeof value === "string" && (rule as readonly string[]).includes(value)) output[key] = value;
  }
  return output;
}

// Drop unknown events and properties, including automatic URLs, user text and profiles.
export function safePostHogProperties(event: string, properties: Record<string, unknown>): Record<string, unknown> | null {
  if (!event.startsWith("reactor_tv:")) return null;
  const name = event.slice("reactor_tv:".length);
  if (!Object.hasOwn(schemas, name)) return null;
  const safe: Record<string, unknown> = {
    ...safeEventProperties(name as StreamEvent, properties),
    app: "reactor_tv", environment: "production", analytics_version: 1,
    token: POSTHOG_PROJECT_TOKEN,
    $current_url: "https://example.com/", $host: "example.com", $pathname: "/",
    $process_person_profile: false, $geoip_disable: true,
  };
  for (const key of ["distinct_id", "$device_id", "$session_id", "$window_id", "$lib", "$lib_version", "$browser", "$browser_version", "$os", "$os_version", "$device_type"]) {
    const value = properties[key];
    if ((typeof value === "string" && /^[a-zA-Z0-9 ._:-]{1,100}$/.test(value)) || typeof value === "number") safe[key] = value;
  }
  if (name === "visit_started" && typeof properties.referrer_host === "string") {
    try { safe.referrer_host = new URL(properties.referrer_host).hostname; } catch { safe.referrer_host = "direct"; }
  }
  return safe;
}

export function safePostHogEvent(event: { event: string; properties: Record<string, unknown>; uuid: string; timestamp?: Date } | null) {
  if (!event) return null;
  const properties = safePostHogProperties(event.event, event.properties);
  return properties ? { event: event.event, uuid: event.uuid, timestamp: event.timestamp, properties } : null;
}

// Map application-owned copy to coarse categories. Never send the reason itself.
export function blockedPromptCategory(reason: string) {
  if (/reconnect/i.test(reason)) return "connection";
  if (/choose a name/i.test(reason)) return "name_required";
  if (/voting/i.test(reason)) return "voting";
  if (/checked/i.test(reason)) return "checking";
  if (/previous prompt|one prompt at a time/i.test(reason)) return "active_prompt";
  if (/loading|session|profile|ready/i.test(reason)) return "loading";
  if (/write a prompt|add your idea/i.test(reason)) return "empty";
  return "unavailable";
}
