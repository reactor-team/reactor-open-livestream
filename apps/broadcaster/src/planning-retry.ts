/** Retry an isolated transport timeout, never invalid plans or model refusals. */
export async function planWithRetry<T>(plan: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await plan(); }
    catch (error) {
      const timeout = error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError" || /timeout|timed out/i.test(error.message));
      if (!timeout) throw error;
      if (attempt >= 1) throw new Error("Cerebras scene planning timed out after two attempts. Retry the stream.", { cause: error });
    }
  }
}
