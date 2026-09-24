"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";

export type DevEnvironment = "local" | "preview" | null;

type DevModeValue = {
  available: boolean;
  enabled: boolean;
  environment: DevEnvironment;
  setEnabled: (enabled: boolean) => void;
};

const STORAGE_KEY = "reactor-tv:dev-mode";
const CHANGE_EVENT = "reactor-tv:dev-mode-change";

const DevModeContext = createContext<DevModeValue>({
  available: false,
  enabled: false,
  environment: null,
  setEnabled: () => undefined,
});

export function DevModeProvider({
  children,
  environment,
}: {
  children: ReactNode;
  environment: DevEnvironment;
}) {
  const available = environment !== null;
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener("storage", notify);
    window.addEventListener(CHANGE_EVENT, notify);
    return () => {
      window.removeEventListener("storage", notify);
      window.removeEventListener(CHANGE_EVENT, notify);
    };
  }, []);
  const getSnapshot = useCallback(() => {
    if (!available) return false;
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  }, [available]);
  const getServerSnapshot = useCallback(() => available, [available]);
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setEnabled = useCallback((next: boolean) => {
    if (!available) return;
    window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, [available]);

  return (
    <DevModeContext.Provider value={{ available, enabled, environment, setEnabled }}>
      {children}
    </DevModeContext.Provider>
  );
}

export function useDevMode(): DevModeValue {
  return useContext(DevModeContext);
}
