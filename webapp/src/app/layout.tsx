import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./stream/voting.css";
import "./stream/mobile.css";
import "./stream/prompt-moderation.css";

import { getBackend } from "@/lib/backend";
import { publicBackend } from "@/lib/backend-config";

import Providers from "./providers";

export const dynamic = "force-dynamic";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#000000", colorScheme: "dark" };

const deploymentUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || deploymentUrl),
  title: "Reactor TV",
  description: "Infinite AI video livestream.",
  openGraph: {
    type: "website",
    siteName: "Reactor TV",
    title: "Reactor TV",
    description: "Infinite AI video livestream.",
  },
  twitter: { card: "summary_large_image" },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const backend = publicBackend(await getBackend());
  const devEnvironment = process.env.NODE_ENV === "development"
    ? "local"
    : (process.env.VERCEL_ENV === "preview" ? "preview" : null);

  return (
    <html data-backend={backend.target} lang="en" className="h-full antialiased">
      <body>
        <Providers backend={backend} devEnvironment={devEnvironment}>{children}</Providers>
      </body>
    </html>
  );
}
