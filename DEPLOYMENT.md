# Deploy your own fork

The upstream `reactor-team/reactor-open-livestream` repository is a source template. Never connect it to a deployment integration or provision a hosted instance for it. Local setup targets development Convex only.

These steps are opt-in for an owner who explicitly wants to publish their own fork after local playback works. They do not run automatically.

## Recommended topology

- Vercel: Next.js viewer and admin, Root Directory **`webapp`**, with access to workspace files outside that directory.
- Convex: your own production database and functions, separate from development.
- Railway or another persistent Docker host: `apps/broadcaster/Dockerfile`, Docker build context at the repository root. Use one replica for one shared stream.
- LiveKit: your own project and a production room separate from development.

## 1. Configure your backend

Create production resources in your own accounts. Set `BROADCASTER_SECRET` and `OPENAI_API_KEY` in production Convex. Use a new production broadcaster secret shared with the production web server and broadcaster. Keep development, preview and production separate.

The development office seed is not copied into production. Add your scenes through the production Admin after deployment, or explicitly run `seed:office` against your own production backend using the Convex CLI. Seeding is never part of build or deploy.

## 2. Configure Vercel

Import **your fork**, choose `webapp` as Root Directory and enable access to files outside it. The checked-in `webapp/vercel.json` installs the workspace and builds Next.js; it does not deploy Convex. For your own project only, configure the Build Command in Vercel to:

```sh
pnpm exec convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
```

Set these server environment variables in the Vercel project:

| Variable | Value |
| --- | --- |
| `CONVEX_DEPLOY_KEY` | Your production deploy key, scoped to Production only |
| `NEXT_PUBLIC_SITE_URL` | Your public site URL |
| `ADMIN_PASSWORD` | Unique strong admin password |
| `BROADCASTER_SECRET` | Matches production Convex and the broadcaster |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Your LiveKit credentials |
| `LIVEKIT_ROOM` | Your production room |

The build command supplies `NEXT_PUBLIC_CONVEX_URL`; ensure it is also available to the deployed app. Keep preview deployment keys and backend secrets isolated, or leave previews unconfigured. Never give preview builds your production deploy key.

Reference: [Convex's Vercel deployment guide](https://docs.convex.dev/production/hosting/vercel).

## 3. Configure the persistent broadcaster

Deploy the Dockerfile with root context. The optional `railway.toml` describes the Docker path and health check. Set:

```text
CONVEX_URL=<your production Convex URL>
BROADCASTER_SECRET=<same production secret>
LIVEKIT_URL=<your LiveKit URL>
LIVEKIT_API_KEY=<your key>
LIVEKIT_API_SECRET=<your secret>
LIVEKIT_ROOM=<same production room as Vercel>
REACTOR_API_KEY=<your Reactor key>
REACTOR_MODEL=reactor/fast-h3
CEREBRAS_API_KEY=<your Cerebras key>
CEREBRAS_MODEL=qwen-3.8-27b
CEREBRAS_REASONING_EFFORT=low
CEREBRAS_TIMEOUT_MS=5000
CLIP_SECONDS=10
```

`PORT` is supplied by Railway. Leave `BROADCASTER_MANUAL` unset in production. The container includes Chromium; no host Chrome installation is needed. It starts automatically and generates while a valid schedule exists. There is no development inactivity lease in production; use your host's stop/scale controls to stop spending.

## 4. Verify before sharing

Verify backend functions, an authenticated Admin login, your schedule, healthy broadcaster state, video and sound, a moderated viewer prompt, and reconnect behavior. Use your own `/admin` URL, not a Reactor deployment.

Anonymous viewer identities are not account authentication or bot prevention. Review access controls, rate limits and provider budgets for your audience. Text moderation does not certify generated pixels. Analytics and Slack alerts are off by default. Nothing in this repository is linked to an upstream production service.
