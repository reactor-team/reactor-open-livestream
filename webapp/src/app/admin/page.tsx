import { DEFAULT_BROADCAST_SETTINGS, type BroadcastSettings } from "@reactor/infinite-contracts";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import Link from "next/link";

import { Logo } from "@/components/reactor-ui";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getBackend } from "@/lib/backend";
import PromptInspector from "../stream/prompt-inspector";
import { BackendNotice } from "../backend-context";
import { logout } from "./actions";
import LoginForm from "./login-form";
import ChatMessageSettings from "./chat-message-settings";
import PromptModerationSettings from "./prompt-moderation-settings";
import SettingsForm from "./settings-form";
import ProgrammingPanel from "./programming-panel";

export const dynamic = "force-dynamic";

async function readSettings(): Promise<BroadcastSettings> {
  const { convexUrl: url } = await getBackend();
  if (!url) return { ...DEFAULT_BROADCAST_SETTINGS };
  try {
    return { ...DEFAULT_BROADCAST_SETTINGS, ...await new ConvexHttpClient(url).query(anyApi.settings.get, {}) };
  } catch {
    return { ...DEFAULT_BROADCAST_SETTINGS };
  }
}

function AdminBrand() {
  return (
    <div className="brand-lockup">
      <Logo variant="wordmark" color="white" className="brand-logo" aria-label="Reactor" />
      <span className="brand-divider" />
      <span className="system-label">TV control</span>
    </div>
  );
}

export default async function AdminPage() {
  const authenticated = await isAdminAuthenticated();

  if (!authenticated) {
    return (
      <main className="admin-login-shell">
        <header className="admin-topbar"><AdminBrand /><PromptInspector /></header>
        <section className="admin-login-stage">
          <div className="admin-login-copy">
            <span className="system-label">Restricted transmission surface</span>
            <h1>Enter the control room.</h1>
            <p>Set the rhythm, schedule, and public service signal for Reactor TV.</p>
          </div>
          <LoginForm />
        </section>
      </main>
    );
  }

  const settings = await readSettings();
  let moderation: { criteria: string[]; revision: number } | null = null;
  try {
    const backend = await getBackend();
    if (backend.secret) moderation = await new ConvexHttpClient(backend.convexUrl).query(anyApi.settings.getPromptModeration, { secret: backend.secret });
  } catch { /* Unavailable policy stays visibly unavailable, never an empty editable fallback. */ }
  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <AdminBrand />
        <nav>
          <PromptInspector />
          <Link href="/">View broadcast</Link>
          <form action={logout}><button type="submit">Lock control room</button></form>
        </nav>
      </header>
      <div className="admin-content">
        <BackendNotice />
        <header className="admin-page-heading">
          <div>
            <span className="system-label">Single channel operations</span>
            <h1>Program control</h1>
          </div>
          <p>Shape the current transmission. No deploy required.</p>
        </header>
        <ProgrammingPanel defaultChunkSeconds={settings.chunkSeconds} />
        <SettingsForm settings={settings} />
        <PromptModerationSettings settings={moderation} />
        <ChatMessageSettings enabledTypes={settings.enabledChatMessageTypes ?? []} />
      </div>
    </main>
  );
}
