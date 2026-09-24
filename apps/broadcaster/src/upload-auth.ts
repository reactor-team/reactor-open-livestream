/** A rejected upload can be repeated; accepted model commands must never be replayed. */
export function isUploadAuthenticationError(error: unknown): boolean {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
  return /\b(?:HTTP status|status(?: code)?[: ]+)\s*401\b/i.test(message)
    && /create upload|upload|invalid or expired token/i.test(message);
}

export async function withUploadAuthRetry<T>(upload: () => Promise<T>, refresh: () => Promise<unknown>): Promise<T> {
  try { return await upload(); }
  catch (error) {
    if (!isUploadAuthenticationError(error)) throw error;
    await refresh();
    return await upload();
  }
}
