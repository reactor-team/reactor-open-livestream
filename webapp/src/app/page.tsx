import type { Metadata } from "next";

import BroadcastApp from "./stream/broadcast-app";

export const metadata: Metadata = {
  title: "Reactor TV",
  description: "One continuous world, generated live.",
};

export default function Home() {
  return <BroadcastApp />;
}
