"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState, type ReactNode } from "react";

import { DevModeProvider, type DevEnvironment } from "./dev-mode";

import { BackendProvider } from "./backend-context";
import type { PublicBackend } from "@/lib/backend-config";

export default function Providers({
  children,
  backend,
  devEnvironment,
}: {
  children: ReactNode;
  backend: PublicBackend;
  devEnvironment: DevEnvironment;
}) {
  const [client] = useState(
    () => new ConvexReactClient(backend.convexUrl),
  );
  return (
    <ConvexProvider client={client}>
      <BackendProvider backend={backend}><DevModeProvider environment={devEnvironment}>{children}</DevModeProvider></BackendProvider>
    </ConvexProvider>
  );
}
