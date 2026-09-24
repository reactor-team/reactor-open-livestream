"use client";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { PublicBackend } from "@/lib/backend-config";

export const BACKEND_CHANGE = "reactor-tv:backend-change";
const Context = createContext<PublicBackend>({ target: "deployment", convexUrl: "", switchable: false, stagingAvailable: false });
export function BackendProvider({ backend, children }: { backend: PublicBackend; children: ReactNode }) {
  useEffect(() => {
    if (!backend.switchable) return;
    const reload = (event: StorageEvent) => { if (event.key === BACKEND_CHANGE) window.location.reload(); };
    window.addEventListener("storage", reload);
    return () => window.removeEventListener("storage", reload);
  }, [backend.switchable]);
  return <Context.Provider value={backend}>{children}</Context.Provider>;
}
export const useBackend = () => useContext(Context);
export function BackendNotice() {
  const backend = useBackend();
  if (!backend.switchable || backend.target !== "staging") return null;
  return <p className="backend-notice" role="status">Connected to staging. Saved edits affect the remote broadcast.</p>;
}
