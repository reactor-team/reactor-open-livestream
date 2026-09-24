export const DEFAULT_FAKE_VIEWERS = 0;
export const MAX_FAKE_VIEWERS = 1_000_000;

export function isValidFakeViewerCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_FAKE_VIEWERS;
}

// Presence stays real. Only the displayed total includes the configured offset.
export function displayedViewerCount(
  actualViewers: number,
  settings: { num_fake_viewers?: number } | undefined,
): number | undefined {
  if (settings === undefined) return undefined;
  return actualViewers + (settings.num_fake_viewers ?? DEFAULT_FAKE_VIEWERS);
}
