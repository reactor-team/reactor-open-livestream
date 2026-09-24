# Reactor Open Livestream

Build a continuous AI video stream that your audience can steer. This open-source, whitelabel starter includes a live player, shared chat, viewer prompts, voting, an admin panel, and an editable office scene.

**Open this repo in Claude Code, Codex, or another software agent. Let the agent guide installation.** You bring your own accounts and API keys; no access to Reactor's internal infrastructure is needed.

[Open local viewer](http://localhost:3000) · [Open admin panel](http://localhost:3000/admin) · [Setup instructions for agents](AGENTS.md)

These links work after the local app starts. The admin panel belongs to your own app; this repository has no hosted deployment.

## Hand this to your agent

Use this repository as a template or clone it:

```sh
git clone https://github.com/reactor-team/reactor-open-livestream.git
cd reactor-open-livestream
```

Open the folder in your agent and paste:

> Read README.md and AGENTS.md, then act as my installation wizard. Check my machine, install dependencies, and guide me through creating my own Convex and LiveKit projects and obtaining Reactor, Cerebras and OpenAI keys. Have me enter credentials securely, never paste or print them in chat. Configure an isolated development backend, add the removable office seed, run the app locally, and give me clickable viewer and admin links. Explain usage costs before starting generation. Verify playback, sound, a viewer prompt and stopping the stream. Then help me customize the branding and scene. Keep this local; do not deploy or connect the upstream repository to any hosting service.

The agent instructions also work through `CLAUDE.md`.

## What you need

| Requirement | Purpose |
| --- | --- |
| Node.js 22+ and pnpm pinned in `package.json` | Run the TypeScript workspace |
| Google Chrome | Local browser media bridge |
| [Convex](https://dashboard.convex.dev) | Database, realtime state, moderation and scheduling |
| [LiveKit](https://cloud.livekit.io) | Broadcast audio and video to viewers |
| [Reactor](https://reactor.inc) API key with FastH3 access | Generate video |
| [Cerebras](https://cloud.cerebras.ai) API key | Plan each scene before generation |
| [OpenAI](https://platform.openai.com/api-keys) API key | Required viewer and final-scene moderation; also Admin AI tools |

The software is open source. Hosted providers have their own access requirements and usage charges. Cerebras and OpenAI are required by the current implementation, including the office demo. The app fails closed when planning or moderation is unavailable.

## Local setup, for you or your agent

1. Install dependencies:

   ```sh
   corepack enable
   pnpm install --frozen-lockfile
   ```

2. Create your own development Convex project:

   ```sh
   pnpm setup:local
   ```

   Follow the Convex login/configuration prompts and choose a **new project** unless you already have a dedicated one for this fork. A cloud development backend is easiest; local Convex also works. This command synchronizes development functions, then exits. Convex writes its selected deployment and `NEXT_PUBLIC_CONVEX_URL` into `webapp/.env.local`. Do not point this at somebody else's backend or use production credentials.

3. Use [webapp/.env.example](webapp/.env.example) as the checklist. Inject credentials from your secret manager, or have the owner copy the template to the ignored `webapp/.env.development.local` and fill it securely. Keep Convex's generated selection in `.env.local`. Use unique, strong values for `ADMIN_PASSWORD` and `BROADCASTER_SECRET` (at least 32 random bytes for the latter). Never commit credentials or put them in `NEXT_PUBLIC_*` variables.

   | Value | Local web app / broadcaster | Convex deployment |
   | --- | --- | --- |
   | `NEXT_PUBLIC_CONVEX_URL` | Written by Convex; broadcaster receives it as `CONVEX_URL` | Not needed |
   | `BROADCASTER_SECRET` | Same secret in both processes | Same secret |
   | `ADMIN_PASSWORD` | Web server only | Not needed |
   | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Both processes, from your LiveKit project | Not needed |
   | `LIVEKIT_ROOM` | Same room in both; template uses `open-livestream-dev` | Not needed |
   | `REACTOR_API_KEY` | Broadcaster only | Not needed |
   | `CEREBRAS_API_KEY` | Broadcaster only | Not needed |
   | `OPENAI_API_KEY` | Not needed for normal playback | Required for moderation and Admin AI |

   Set the two Convex secrets through your own Convex dashboard or the CLI's interactive input, without placing secret values in shell history:

   ```sh
   pnpm --dir webapp exec convex env set BROADCASTER_SECRET
   pnpm --dir webapp exec convex env set OPENAI_API_KEY
   pnpm setup:check
   ```

   The check prints only configured/missing status. It does not validate provider access or read back backend secrets. The broadcaster defaults to `reactor/fast-h3` and Cerebras `qwen-3.8-27b`; confirm your accounts can access those models. Planner timeouts must be shorter than a clip.

4. Add the office scene to your selected development backend:

   ```sh
   pnpm seed:office
   ```

   This creates one library scene and one enabled five-minute schedule slot. It never starts generation. Re-running it preserves edits and does not duplicate or re-enable the scene.

5. Start the application:

   ```sh
   pnpm dev
   ```

   Open the [viewer](http://localhost:3000) and [admin panel](http://localhost:3000/admin). The local broadcaster starts idle. Review the schedule, then click **Start stream** to begin paid generation. Enable sound in the player. Submit a prompt after choosing a viewer name and verify that it airs.

   **Stop stream** closes the local model/media session. A five-minute inactivity lease also stops it. [Broadcaster health](http://127.0.0.1:8787/health) reports process state; actual video and sound still need a browser check. Local development has relaxed admin access and must stay on a trusted machine. Production requires the admin password and hides local stream controls.

## Make it yours

The default scene is an original workplace comedy: three coworkers, one suggestion box, and an ordinary office. It uses no bundled image, recording or TV character. Edit it in [Admin](http://localhost:3000/admin), add your own opening image, or create another scene and schedule it.

To remove it from playback, disable or remove its entry in **Admin > Schedule**. To delete the seeded library item and its schedule entries entirely:

```sh
pnpm seed:remove-office
```

Stop the stream first for immediate removal from playback. Already-buffered clips may otherwise finish. No startup hook recreates the seed. An empty schedule stays idle. [Seed source](webapp/convex/lib/officeSeed.ts) is ordinary editable code.

For whitelabel changes, ask your agent to update:

- Title and share metadata: `webapp/src/app/layout.tsx` and `webapp/src/app/opengraph-image.png` and its alt text.
- Logo and header links: `webapp/src/components/reactor-tv-lockup.tsx` and `partner-actions.tsx`.
- Colors and typography: `webapp/src/app/globals.css`. The starter uses system fonts.
- Offline copy: `packages/contracts/src/broadcast-message.ts`.
- Banner, scenes, rotation, voting and additional moderation criteria: **Admin**.

The default UI retains Reactor's layout and links as a starting point. The viewer count defaults to actual connected viewers (zero artificial offset). Analytics is disabled and no production tracking key is included. Optional Slack alerts stay disabled until configured for your own workspace.

## How it works

```text
Viewer prompts / chat / votes -> Convex
                                  |
                         persistent broadcaster
                         | Cerebras scene planning
                         | Convex / OpenAI safety check
                         | Reactor video generation
                         v
                       LiveKit -> every viewer
```

`webapp/` is the Next.js viewer/admin and Convex backend. `apps/broadcaster/` is a persistent Node process supervising Chromium. `packages/contracts/` holds shared types and rules. The browser bridge is needed for Reactor's media tracks; a serverless web function cannot replace the broadcaster.

## Hosting your own fork

**This upstream repository never deploys.** It has no deployment workflow or connected hosting project. Do not connect `reactor-team/reactor-open-livestream` to a production service.

When you are ready to publish **your own fork**, we recommend **Vercel for `webapp/`**, Convex for the backend, and a persistent Docker host such as Railway for `apps/broadcaster/`. The broadcaster must run continuously and cannot run as a Vercel function. See [DEPLOYMENT.md](DEPLOYMENT.md) for the separate, opt-in deployment steps.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

These do not start a livestream. Live playback verification requires your own configured provider accounts.

Licensed under [Apache-2.0](LICENSE). Dependency licenses still apply. Hosted models, provider services, and third-party trademarks are not relicensed by this repository.
