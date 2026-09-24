"use client";

import { useBackend } from "../backend-context";
import { useDevMode } from "../dev-mode";

export default function DevModeToggle() {
  const backend = useBackend();
  const { available, enabled, environment, setEnabled } = useDevMode();
  if (!available) return null;

  return (
    <button
      aria-label={enabled ? "Switch to production simulation" : "Switch to developer mode"}
      aria-pressed={enabled}
      className="dev-mode-toggle"
      data-enabled={enabled || undefined}
      onClick={() => setEnabled(!enabled)}
      title={enabled ? "Switch to the production interface simulation" : "Switch to developer tools"}
      type="button"
    >
      <span className="dev-mode-option" data-active={enabled || undefined}>Dev</span>
      <i aria-hidden="true"><b /></i>
      <span className="dev-mode-option" data-active={!enabled || undefined}>Prod sim</span>
      <small>{backend.target === "staging" ? "staging" : environment}</small>
    </button>
  );
}
