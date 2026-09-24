# Optional outage alerts

Disabled by default. To enable on your own deployment, configure `SLACK_STREAM_WEBHOOK_URL` and optionally `SLACK_STREAM_ALERT_MENTION` (comma-separated member IDs, or `none`) in Convex only. Keep webhooks out of browser variables and git.

After a working broadcast is confirmed, explicitly run `streamAlerts:configure` with `{"enabled":true}` using the Convex CLI on your intended deployment. Use `streamAlerts:inspect` to check state, and configure `{"enabled":false}` to disable. Nothing in setup enables alerts.

The monitor requires actual advancing video, alerts after five minutes without confirmed progress, and requires four stable seconds for recovery. Down alerts may mention configured members; recovery never pings. The monitor is independent of the broadcaster process but cannot report when Convex itself is unavailable. Delivery retries are bounded.
