import posthog from "posthog-js";
import { analyticsEnabled, POSTHOG_HOST, POSTHOG_PROJECT_TOKEN, safeEventProperties, safePostHogEvent, type EventProperties, type StreamEvent } from "./analytics-policy";

let initialized = false;

export function initializeStreamAnalytics() {
  if (typeof window === "undefined" || !analyticsEnabled(window.location.hostname, window.location.pathname, process.env.NODE_ENV === "production")) return false;
  if (initialized) return true;
  try {
    posthog.init(POSTHOG_PROJECT_TOKEN, {
      api_host: POSTHOG_HOST, ui_host: "https://us.posthog.com", defaults: "2026-05-30",
      persistence: "localStorage", person_profiles: "never", ip: false, respect_dnt: true,
      autocapture: false, capture_pageview: false, capture_pageleave: false,
      capture_exceptions: false, capture_dead_clicks: false, capture_heatmaps: false,
      capture_performance: false, disable_session_recording: true, disable_surveys: true,
      disable_external_dependency_loading: true, advanced_disable_feature_flags: true,
      advanced_disable_flags: true, disable_conversations: true, disable_product_tours: true,
      save_referrer: false, save_campaign_params: false,
      before_send: event => {
        if (!analyticsEnabled(window.location.hostname, window.location.pathname, process.env.NODE_ENV === "production")) return null;
        return safePostHogEvent(event);
      },
    });
    initialized = true;
    return true;
  } catch { return false; }
}

export function captureStreamEvent(event: StreamEvent, properties: EventProperties = {}) {
  // Also handles a client-side return to the stream from an untracked Admin route.
  if (!initializeStreamAnalytics()) return;
  try {
    posthog.capture(`reactor_tv:${event}`, {
      ...safeEventProperties(event, properties),
      ...(event === "visit_started" ? { referrer_host: document.referrer } : {}),
    });
  } catch { /* Analytics must never affect playback, submission or navigation. */ }
}
