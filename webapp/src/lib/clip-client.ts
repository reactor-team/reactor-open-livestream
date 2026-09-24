export async function prepareClip(files: Blob[], signal: AbortSignal, range?: { start: number; end: number }, progress?: (fraction: number) => void) {
  const { assembleClip, exportBrowserClip } = await import("./browser-clip-export");
  signal.throwIfAborted();
  const deadline = AbortSignal.timeout(120_000);
  const operation = AbortSignal.any([signal, deadline]);
  try {
    if (range) {
      if (files.length !== 1) throw new Error("Capture a moment before choosing a clip.");
      return await exportBrowserClip(files[0], range, operation, progress);
    }
    return await assembleClip(files, operation, progress);
  } catch (error) {
    if (deadline.aborted && !signal.aborted) throw new Error("Export took too long. Try a shorter selection.");
    if (error instanceof Error && /^(This |Choose |Let |MP4 |Capture )/.test(error.message)) throw error;
    throw new Error("Couldn't prepare this clip. Try another moment or use the latest Chrome.");
  }
}
