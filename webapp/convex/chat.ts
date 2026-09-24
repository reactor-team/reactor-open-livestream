import { BROADCAST_KEY, chatMessageType, isReactionKey, MAX_REACTIONS_PER_VIEWER, MAX_REACTION_TYPES, normalizeChatMessageTypes, orderedWaitingPrompts } from "@reactor/infinite-contracts";
import { ConvexError, v } from "convex/values";
import { saveViewerName, viewerNameSubmissionError } from "./lib/viewerNames";

import { mutation, query } from "./_generated/server";
import { chatText, cleanAuthor, cleanIdentity } from "./lib";
import { resolveMentions } from "./lib/chatSocial";

export const recent = query({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db.query("settings").withIndex("by_key", q => q.eq("key", BROADCAST_KEY)).unique();
    const enabledTypes = normalizeChatMessageTypes(settings?.enabledChatMessageTypes);
    const storedKinds = [...new Set(enabledTypes.map(type => type === "vote-closed" ? "vote-open" : type))];
    // Separate indexed lanes keep hidden bot history from crowding out viewer chat.
    const [lanes, queued, pending] = await Promise.all([
      Promise.all([undefined, ...storedKinds].map(kind => ctx.db.query("messages")
        .withIndex("by_system_kind_created", q => q.eq("systemKind", kind)).order("desc").take(100))),
      ctx.db.query("prompts").withIndex("by_status_created", (q) => q.eq("status", "queued")).collect(),
      ctx.db.query("prompts").withIndex("by_status_created", (q) => q.eq("status", "pending")).collect(),
    ]);
    const queuePositions = new Map(
      orderedWaitingPrompts([...queued, ...pending]).map((prompt, index) => [prompt._id, index + 1]),
    );

    const candidates = lanes.flat();
    const stars = new Map(await Promise.all([...new Set(candidates.filter(row => !row.systemKind).map(row => row.identity))].map(async identity => {
      const row = await ctx.db.query("viewerStars").withIndex("by_identity", q => q.eq("identity", identity)).unique();
      return [identity, row?.count ?? 0] as const;
    })));
    const hydrated = await Promise.all(candidates.map(async (message) => {
      if (message.systemKind) {
        const round = message.roundId ? await ctx.db.get(message.roundId) : null;
        const type = chatMessageType(message.systemKind, round?.status);
        if (!enabledTypes.some(enabled => enabled === type)) return null;
        return { ...message, kind: "system" as const, vote: round ? {
          status: round.status, durationChunks: round.durationChunks, completedChunks: round.completedChunks,
          segmentTitle: round.segmentTitle, winnerIndex: round.winnerIndex,
          options: round.options.map(({ label, votes }) => ({ label, votes })),
        } : null };
      }
      const social = { stars: stars.get(message.identity) ?? 0 };
      if (!message.promptId) return { ...message, ...social, kind: "message" as const };
      const prompt = await ctx.db.get(message.promptId);
      if (prompt?.status === "blocked") return null;
      return {
        ...message,
        ...social,
        kind: "prompt" as const,
        promptStatus: prompt?.status ?? "played",
        queuePosition: queuePositions.get(message.promptId),
      };
    }));
    return hydrated.filter(message => message !== null)
      .sort((a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime).slice(0, 100);
  },
});

// Keep personalized selections separate so the shared chat subscription stays cacheable.
export const ownReactions = query({
  args: { identity: v.string(), messageIds: v.array(v.id("messages")) },
  handler: async (ctx, { identity, messageIds }) => {
    if (!identity || cleanIdentity(identity) !== identity || messageIds.length > 100) throw new ConvexError("Invalid reaction request.");
    const pairs = await Promise.all([...new Set(messageIds)].map(async messageId => {
      const rows = await ctx.db.query("messageReactions")
        .withIndex("by_message_identity_key", q => q.eq("messageId", messageId).eq("identity", identity)).take(MAX_REACTIONS_PER_VIEWER);
      return [messageId, rows.map(row => row.key)] as const;
    }));
    return Object.fromEntries(pairs);
  },
});

export const send = mutation({
  args: { body: v.string(), author: v.string(), identity: v.string() },
  handler: async (ctx, args) => {
    const body = chatText(args.body);
    const author = cleanAuthor(args.author);
    const identity = cleanIdentity(args.identity);
    if (!body || !author || !identity) throw new Error("Message is incomplete");
    const reason = await viewerNameSubmissionError(ctx, identity, author);
    if (reason) throw new ConvexError(reason);
    await saveViewerName(ctx, identity, author);
    return await ctx.db.insert("messages", { body, author, identity, createdAt: Date.now(), mentions: await resolveMentions(ctx, body) });
  },
});

export const setReaction = mutation({
  args: { messageId: v.id("messages"), identity: v.string(), author: v.string(), key: v.string(), active: v.boolean() },
  handler: async (ctx, args) => {
    if (!isReactionKey(args.key)) throw new ConvexError("Choose one of the available reactions.");
    if (!args.identity || cleanIdentity(args.identity) !== args.identity) throw new ConvexError("Refresh the page to reconnect to chat.");
    const reason = await viewerNameSubmissionError(ctx, args.identity, args.author);
    if (reason) throw new ConvexError(reason);
    const message = await ctx.db.get(args.messageId);
    if (!message || message.systemKind) throw new ConvexError("This message is no longer available for reactions.");
    const existing = await ctx.db.query("messageReactions")
      .withIndex("by_message_identity_key", q => q.eq("messageId", args.messageId).eq("identity", args.identity).eq("key", args.key)).unique();
    if (Boolean(existing) === args.active) return;
    if (args.active) {
      const own = await ctx.db.query("messageReactions")
        .withIndex("by_message_identity_key", q => q.eq("messageId", args.messageId).eq("identity", args.identity)).take(MAX_REACTIONS_PER_VIEWER);
      if (own.length >= MAX_REACTIONS_PER_VIEWER) throw new ConvexError(`Choose up to ${MAX_REACTIONS_PER_VIEWER} reactions per message. Remove one to add another.`);
      if (!message.reactionCounts?.[args.key] && Object.keys(message.reactionCounts ?? {}).length >= MAX_REACTION_TYPES) {
        throw new ConvexError("This message has lots of reactions already. Choose an existing one.");
      }
    }
    if (existing) await ctx.db.delete(existing._id);
    else await ctx.db.insert("messageReactions", { messageId: args.messageId, identity: args.identity, key: args.key });
    const counts = { ...message.reactionCounts };
    const count = Math.max(0, (counts[args.key] ?? 0) + (args.active ? 1 : -1));
    if (count) counts[args.key] = count;
    else delete counts[args.key];
    await ctx.db.patch(message._id, { reactionCounts: counts });
  },
});
