# Viewer and backend

Start with the root [installation guide](../README.md). This package contains Next.js and Convex.

- [Viewer](http://localhost:3000): live video, sound, chat, prompts or voting.
- [Admin](http://localhost:3000/admin): segment library, schedule, banner, chunk length and moderation criteria.
- `/api/livekit/token`: server-minted, subscribe-only LiveKit token.
- `/admin/api/programming`: library and rotation editing, authenticated outside local development.
- `/admin/api/enrich`: authenticated Admin AI enrichment through Convex/OpenAI.
- `/api/dev/segment` and `/api/dev/segment/queue`: local/preview workshop; unavailable in production.

Convex stores durable product state. The original office seed lives in `convex/lib/officeSeed.ts`; `convex/seed.ts` adds/removes it only on explicit CLI invocation. Never restore it automatically.

Viewer names use anonymous browser identities, not person-level authentication. Shared chat and prompt admission have separate moderation. Every compiled scene passes a final safety check before generation. Provider failures fail closed; text moderation does not inspect generated pixels.

Local Start/Stop controls manage a five-minute activity lease. Keep the local server on a trusted machine. Production hides these controls and requires ADMIN_PASSWORD for Admin.

Analytics is disabled; see [ANALYTICS.md](ANALYTICS.md). Optional alerts are described in [OUTAGE_ALERTS.md](../OUTAGE_ALERTS.md). Browser clipping stays local; see [CLIPPING.md](CLIPPING.md). No credentials or data from an upstream deployment are included.
