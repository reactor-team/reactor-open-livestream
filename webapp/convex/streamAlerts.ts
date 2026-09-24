import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireBroadcasterSecret } from "./lib";
import { DELIVERY_LEASE_MS, MAX_DELIVERY_ATTEMPTS, OUTAGE_THRESHOLD_MS, RECOVERY_STABILITY_MS,
  SAMPLE_MAX_AGE_MS, postSlackAlert, slackAlertUserIds, slackOutageMessage, slackWebhookUrl } from "./lib/streamAlerts";

const phase = v.union(v.literal("down"), v.literal("recovery"));
const deliveryArgs = { incidentId: v.id("streamOutages"), phase };
const monitor = (ctx: Pick<QueryCtx, "db">) => ctx.db.query("streamMonitor").withIndex("by_key", q => q.eq("key", "main")).unique();
const terminal = (state: string) => state === "sent" || state === "failed";

async function scheduleCheck(ctx: MutationCtx, epoch: number, lastHealthyAt: number) {
  const row = await monitor(ctx);
  if (!row) return;
  const deadline = lastHealthyAt + OUTAGE_THRESHOLD_MS + 1;
  await ctx.db.patch(row._id, { nextCheckAt: deadline });
  await ctx.scheduler.runAfter(Math.max(0, deadline - Date.now()), internal.streamAlerts.check, { epoch, deadline });
}

async function openIncident(ctx: MutationCtx, row: Doc<"streamMonitor">, now: number) {
  const incidentId = await ctx.db.insert("streamOutages", {
    epoch: row.epoch, startedAt: row.lastHealthyAt ?? row.armedAt, detectedAt: now,
    down: { state: "pending", attempts: 0 },
  });
  await ctx.db.patch(row._id, { incidentId, healthySince: undefined, nextCheckAt: undefined });
  await ctx.scheduler.runAfter(0, internal.streamAlerts.deliver, { incidentId, phase: "down" });
  return incidentId;
}

/** Private operator surface, never returned by the public broadcast query. */
export const inspect = internalQuery({
  args: {},
  handler: async (ctx) => ({
    monitor: await monitor(ctx),
    outageThresholdMs: OUTAGE_THRESHOLD_MS,
    webhookConfigured: Boolean(slackWebhookUrl()),
    mention: slackAlertUserIds().length ? "users" : "none",
    mentionUserIds: slackAlertUserIds(),
    incidents: await ctx.db.query("streamOutages").withIndex("by_detected").order("desc").take(10),
  }),
});

/** Enable after the production publisher and channel-scoped webhook are verified. */
export const configure = internalMutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const row = await monitor(ctx);
    const now = Date.now();
    if (enabled && !slackWebhookUrl()) throw new Error("Configure a channel-scoped SLACK_STREAM_WEBHOOK_URL in Convex first");
    if (enabled && (!row?.lastPulseAt || now - row.lastPulseAt > SAMPLE_MAX_AGE_MS)) {
      throw new Error("Deploy the production media health publisher and verify fresh samples before enabling alerts");
    }
    if (row?.enabled === enabled) return;
    const value = { enabled, epoch: (row?.epoch ?? 0) + 1, armedAt: now,
      lastHealthyAt: enabled ? now : row?.lastHealthyAt, healthySince: undefined, incidentId: undefined, nextCheckAt: undefined };
    if (row) await ctx.db.patch(row._id, value);
    else await ctx.db.insert("streamMonitor", { key: "main", ...value });
    if (enabled) await scheduleCheck(ctx, value.epoch, now);
  },
});

export const pulse = mutation({
  args: { secret: v.string(), sessionStartedAt: v.number(), observedAt: v.number(), healthy: v.boolean() },
  handler: async (ctx, args) => {
    requireBroadcasterSecret(args.secret);
    const now = Date.now();
    if (!Number.isFinite(args.observedAt) || !Number.isFinite(args.sessionStartedAt)
      || args.sessionStartedAt <= 0 || now - args.observedAt > SAMPLE_MAX_AGE_MS || args.observedAt > now + 1000) return;
    const broadcast = await ctx.db.query("broadcasts").withIndex("by_key", q => q.eq("key", "main")).unique();
    if (broadcast?.startedAt !== args.sessionStartedAt) return;
    const healthy = args.healthy && broadcast.status === "live";
    const row = await monitor(ctx);
    if (row && ((row.sessionStartedAt ?? 0) > args.sessionStartedAt || (row.observedAt ?? 0) >= args.observedAt)) return;
    const sample = { lastPulseAt: now, sessionStartedAt: args.sessionStartedAt, observedAt: args.observedAt };
    if (!row) {
      await ctx.db.insert("streamMonitor", { key: "main", enabled: false, epoch: 0, armedAt: now,
        ...sample, ...(healthy ? { lastHealthyAt: now } : {}) });
      return;
    }
    // Late scheduler execution must not hide an outage when the first recovery sample arrives.
    let incidentId = row.incidentId;
    if (row.enabled && !incidentId && now - (row.lastHealthyAt ?? row.armedAt) > OUTAGE_THRESHOLD_MS) {
      incidentId = await openIncident(ctx, row, now);
    }
    const healthySince = healthy
      ? (row.healthySince !== undefined && row.lastPulseAt !== undefined && now - row.lastPulseAt <= SAMPLE_MAX_AGE_MS ? row.healthySince : now)
      : undefined;
    await ctx.db.patch(row._id, { ...sample, healthySince, ...(healthy ? { lastHealthyAt: now } : {}) });
    if (row.enabled && incidentId && healthySince !== undefined && now - healthySince >= RECOVERY_STABILITY_MS) {
      const incident = await ctx.db.get(incidentId);
      if (incident && incident.recoveredAt === undefined) {
        await ctx.db.patch(incidentId, { recoveredAt: healthySince, recovery: { state: "pending", attempts: 0 } });
        await ctx.db.patch(row._id, { incidentId: undefined });
        if (terminal(incident.down.state)) await ctx.scheduler.runAfter(0, internal.streamAlerts.deliver, { incidentId, phase: "recovery" });
        await scheduleCheck(ctx, row.epoch, now);
      }
    }
  },
});

export const check = internalMutation({
  args: { epoch: v.number(), deadline: v.number() },
  handler: async (ctx, { epoch, deadline }) => {
    const row = await monitor(ctx);
    if (!row?.enabled || row.epoch !== epoch || row.nextCheckAt !== deadline || row.incidentId) return;
    const lastHealthyAt = row.lastHealthyAt ?? row.armedAt;
    const now = Date.now();
    if (now - lastHealthyAt > OUTAGE_THRESHOLD_MS) await openIncident(ctx, row, now);
    else await scheduleCheck(ctx, epoch, lastHealthyAt);
  },
});

export const claimDelivery = internalMutation({
  args: deliveryArgs,
  handler: async (ctx, args) => {
    const row = await monitor(ctx);
    const incident = await ctx.db.get(args.incidentId);
    const current = incident?.[args.phase];
    if (!row?.enabled || !incident || incident.epoch !== row.epoch || current?.state !== "pending"
      || (args.phase === "recovery" && !terminal(incident.down.state))) return null;
    const attempt = current.attempts + 1;
    await ctx.db.patch(incident._id, { [args.phase]: { state: "sending", attempts: attempt, attemptedAt: Date.now() } });
    await ctx.scheduler.runAfter(DELIVERY_LEASE_MS, internal.streamAlerts.expireDelivery, { ...args, attempt });
    return { incident, attempt };
  },
});

async function finish(ctx: MutationCtx, args: { incidentId: Doc<"streamOutages">["_id"]; phase: "down" | "recovery";
  attempt: number; ok: boolean; retryable: boolean; errorCode?: string; retryAfterMs?: number }) {
  const incident = await ctx.db.get(args.incidentId);
  const current = incident?.[args.phase];
  if (!incident || current?.state !== "sending" || current.attempts !== args.attempt) return;
  const retry = !args.ok && args.retryable && args.attempt < MAX_DELIVERY_ATTEMPTS;
  await ctx.db.patch(incident._id, { [args.phase]: {
    ...current, state: args.ok ? "sent" : retry ? "pending" : "failed",
    ...(args.ok ? { sentAt: Date.now() } : { errorCode: args.errorCode }),
  } });
  if (retry) await ctx.scheduler.runAfter(args.retryAfterMs ?? args.attempt * 5000, internal.streamAlerts.deliver, {
    incidentId: args.incidentId, phase: args.phase,
  });
  else if (args.phase === "down" && incident.recovery?.state === "pending") {
    await ctx.scheduler.runAfter(0, internal.streamAlerts.deliver, { incidentId: args.incidentId, phase: "recovery" });
  }
  if (!args.ok && !retry) console.error("[stream-alert] Delivery failed", args.incidentId, args.phase, args.errorCode);
}

export const finishDelivery = internalMutation({
  args: { ...deliveryArgs, attempt: v.number(), ok: v.boolean(), retryable: v.boolean(),
    errorCode: v.optional(v.string()), retryAfterMs: v.optional(v.number()) },
  handler: finish,
});

export const expireDelivery = internalMutation({
  args: { ...deliveryArgs, attempt: v.number() },
  handler: async (ctx, args) => finish(ctx, { ...args, ok: false, retryable: true, errorCode: "delivery_timed_out" }),
});

export const deliver = internalAction({
  args: deliveryArgs,
  handler: async (ctx, args): Promise<void> => {
    const claimed = await ctx.runMutation(internal.streamAlerts.claimDelivery, args);
    if (!claimed) return;
    const url = slackWebhookUrl();
    const outcome = url ? await postSlackAlert(url, slackOutageMessage(args.phase, claimed.incident, Date.now()))
      : { ok: false, retryable: false, errorCode: "webhook_not_configured" };
    await ctx.runMutation(internal.streamAlerts.finishDelivery, { ...args, attempt: claimed.attempt, ...outcome });
  },
});
