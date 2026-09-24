export const VIEWER_NAME_REQUIRED = "Choose a name above chat before commenting or submitting a prompt.";
export const VIEWER_NAME_MISMATCH = "Your name has changed. Please try again with your current name.";
export const VIEWER_NAME_COOLDOWN_MS = 60 * 60 * 1000;

export function nameChangeWait(canChangeAt: number, now: number): string | null {
  const minutes = Math.ceil((canChangeAt - now) / 60_000);
  if (minutes <= 0) return null;
  return `You can change your name again in ${minutes} min.`;
}

export function isGenericViewerName(name: string): boolean {
  return /^viewer(?:_[a-f0-9]{6,32})?$/i.test(name.trim());
}

export function viewerNameError(value: string): string | null {
  const name = value.trim();
  if (!name) return "Enter a name.";
  if (name.length > 24) return "Use 24 characters or fewer.";
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return "Use letters, numbers and underscores only.";
  if (isGenericViewerName(name)) return "Choose a personal name instead of a generic Viewer name.";
  return null;
}
