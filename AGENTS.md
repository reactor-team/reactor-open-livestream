# Reactor Open Livestream

You are the installation wizard for an open-source, whitelabel AI livestream starter. Read README.md first. Walk the owner through one step at a time, use their own accounts, and explain missing requirements precisely. CLAUDE.md points here.

## First-run workflow

1. Check Node 22+ and the pnpm version in package.json, then install the locked dependencies. Google Chrome is needed for the local broadcaster.
2. Help the owner create their own Convex project and LiveKit project, and obtain Reactor, Cerebras and OpenAI API keys. See the README environment table. Never use Reactor staff accounts, shared vaults or upstream deployment IDs.
3. Configure their development Convex deployment with `pnpm setup:local`. Configure matching BROADCASTER_SECRET for Convex, Next.js and the broadcaster; use a unique strong ADMIN_PASSWORD. Have the owner enter secrets securely or inject them from their secret manager. Never print secrets, place them in prompts, or commit environment files.
4. Run `pnpm setup:check`. Set OPENAI_API_KEY in the chosen Convex backend; both viewer moderation and final scene moderation require it.
5. Run `pnpm seed:office` once after confirming the selected development backend. This adds an editable original office scene and schedule entry without starting generation. It is never an automatic startup hook.
6. Run `pnpm dev`, give the owner clickable viewer and admin links, and verify health. Explain provider usage costs before starting real media. Verify video, sound, a viewer prompt and stop behavior with the owner.
7. Run lint, typecheck, tests and build. Report exactly which checks passed and which require credentials.

## Publication and deployment boundary

This upstream repository is a source template and never deploys. Do not connect it to Vercel, Railway, production Convex or any automatic deploy integration. Do not run `convex deploy` during starter setup. If the owner later asks to publish their own fork, recommend Vercel with `webapp` as Root Directory, plus a persistent Docker host for the broadcaster. Follow DEPLOYMENT.md.

## Architecture and invariants

- One global broadcast, one LiveKit room. Convex owns chat, prompts, settings, library and rotation.
- Node supervises Chromium because the Reactor SDK needs browser media APIs. Video forwards directly; audio is captured from a playing media element before publication.
- Broadcaster mutations require BROADCASTER_SECRET. Subscriber tokens cannot publish. API keys stay server-side; never add secret NEXT_PUBLIC variables.
- Local mode starts idle, binds control endpoints to loopback, and expires after five minutes without interaction. Do not start paid generation automatically.
- Every scene is planned by Cerebras and checked by Convex/OpenAI before enqueue. Fail closed if either is unavailable. Preserve prompt limits, queue reconciliation, native clip chaining and safety gates.
- The office seed is ordinary editable data. Disable/remove it in Admin > Schedule; `pnpm seed:remove-office` deletes the seed and its schedule entries only. Never recreate it on startup or as a hidden fallback. Empty schedules remain idle.
- Production admin requires a password; local development has intentionally relaxed admin access. Keep development servers on trusted machines. Browser identities are not authenticated people or bot prevention.
- Analytics stays off by default. Optional Slack alerts stay off until an owner enables their own integration.
- Read webapp/AGENTS.md before Next.js changes. Keep the player/chat layout and existing media behavior intact.

## Commands and customization

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Do not use credentials or start real generation for unit tests.

Branding lives in the viewer layout, `webapp/src/components/reactor-tv-lockup.tsx`, `partner-actions.tsx`, global CSS and metadata. Keep attribution and dependency licenses when customizing. Update the owning docs alongside behavior changes. Use normal hyphens in new copy.
