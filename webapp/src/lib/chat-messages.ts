type ChatRow = { _id: string; kind: string; createdAt?: number; systemKind?: string; roundId?: string };

// Events stay in Convex; chronological chat shows one evolving outcome per round.
export function mergeVoteOutcomes<T extends ChatRow>(messages: readonly T[]): T[] {
  const result: T[] = [];
  const outcomes = new Map<string, number>();
  for (const message of messages) {
    const isOutcome = message.kind === "system" && message.roundId
      && (message.systemKind === "vote-winner" || message.systemKind === "vote-playing");
    if (!isOutcome || !message.roundId) {
      result.push(message);
      continue;
    }
    const index = outcomes.get(message.roundId);
    if (index === undefined) {
      outcomes.set(message.roundId, result.length);
      result.push(message);
    } else if (message.systemKind === "vote-playing" || result[index].systemKind !== "vote-playing") {
      // Keep the first row's identity, creation time and position as its status advances.
      const original = result[index];
      result[index] = { ...message, _id: original._id,
        ...(original.createdAt === undefined ? {} : { createdAt: original.createdAt }),
      };
    }
  }
  return result;
}
