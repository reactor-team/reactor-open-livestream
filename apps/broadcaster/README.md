# Broadcaster

## Prompt timing telemetry

The supervisor observes planning and existing clip lifecycle events through src/prompt-timing.ts, without controlling playback. It publishes bounded, viewer-safe timestamps, prompt/clip ids, actual clip durations and the last 12 planning/generation samples to broadcast.updateQueueTiming. Updates are coalesced for 200ms and refreshed with the normal heartbeat. They never refresh liveness themselves. Convex ignores old-session and out-of-order snapshots. No prompt text, image, metadata or credential is published. Every new bridge starts with fresh timing samples. The shared contracts forecast drives chat and schedule, accounting for both serial lanes and three outstanding clips, and falls back to status text when timing is not credible.

The broadcaster is the persistent service in Reactor Infinite. Railway runs one instance.

`src/supervisor.ts` is the production container entrypoint. It runs exactly one `server.ts` worker at a time, replacing exited workers without depending on Railway to restart the container. It holds no credentials cache, scene history, model session or media tracks. Manual development bypasses this outer supervisor.

`src/server.ts` is the Node supervisor. It validates configuration, talks to Convex and Cerebras, mints the LiveKit publisher token and Reactor session token, serves `/health`, and launches headless Chromium.

`src/bridge.ts` runs inside Chromium. It connects to `reactor/fast-h3`, generates continuous chained clips, receives the model's audio and video tracks, and publishes them to the single LiveKit room. Video forwards directly as one layer with simulcast disabled, avoiding redundant browser encodes. The bitrate cap remains configurable; actual resolution and frame rate require measurement. Audio is played through a browser media element and republished from its captured output because forwarding a remote WebRTC audio track directly into LiveKit produces a muted subscriber track in Chrome. The build copies the Reactor SDK's WebAssembly runtime beside the browser bundle so Chromium can load it from the supervisor. Reactor clip metadata carries the Convex prompt id, original viewer text, author, segment-boundary marker, and optional legacy interactive table snapshot needed to drive durable prompt and timing state. Planner output and segment constitutions stay in the broadcaster so metadata remains under FastH3's 2,000-character limit. Every `clip_started` event stamps the current chunk start in Convex. A marked boundary clip also stamps the current segment start, so all viewers share the same chunk and program clocks.

## Story and visual continuity

Scene output uses strict JSON-schema `maxLength` constraints, with compiler-owned caps for visual, sound, dialogue, speaker and casting fields. `sceneVisualBudget` reserves the worst-case complete dialogue, fixed voice, sound, punctuation, separators and application geometry before requesting the visual. A known cast constrains speaker to an enum; no cast requires empty dialogue. This keeps the generated field budgets within the assembled 800-character ceiling without chopping up prose or spoken lines. The compiler still independently validates every response and permits one repair under the existing deadline. Schema constraints do not guarantee provider uptime, valid creative semantics, or uninterrupted playback. See [Cerebras structured outputs](https://inference-docs.cerebras.ai/capabilities/structured-outputs) for the strict-decoding contract.

The public production `/health` endpoint preserves its true status and 503 on degradation but returns fixed safe detail, not a raw exception. Full diagnostics remain in supervisor logs and loopback-only development endpoints. Convex stores operator detail but its public broadcast query replaces it with safe copy. The viewer independently renders the fixed interruption message, Reactor TV will be right back.

Every chunk start calls `prompts.markPlaying`, including automatic chunks with no prompt id. Convex atomically retires other playing prompts, so a missing finish event cannot leave a viewer's one-prompt limit stuck. The bridge preserves the on-air receipt when replacing buffered clips, drops a superseded on-air receipt when a successor starts, and retires stopped prompts. Late finish events are idempotent. Only confirmed playback transitions release a playing prompt; pending and queued requests are not expired by age. Deploy the compatible optional-id Convex mutation before updating the broadcaster.

Every chunk uses the configured duration, 10 seconds by default, and receives a fresh scene plan. The bridge keeps three outstanding clips, including the playing one. Matching completion events retire that prompt and free capacity to generate the next scene while the other clip plays. Input arriving after a clip is planned waits for a later chunk. No mandatory resting poses, alternate idle clips or repeated opening images are inserted. Generation-ahead buffering reduces gaps but cannot guarantee gapless output when generation falls behind.

The bridge uses `starting_frame` only for segment openings and `continue_from_clip_id` for subsequent clips. It does not require `ending_frame` support.

Segments are defined in a shared Convex library edited in Admin or the workshop. Admin schedules slots referencing library segments; the workshop also provides direct overrides. Built-in demo launchers and audience table controls are absent. The optional table snapshot handling remains for compatibility with existing prompt rows and internal planner regression fixtures. No new table runs are created by segment submissions.

Startup reads `schedule.list`, which joins enabled `scheduleEntries` to their `segments` definitions, in position order and starts the first. Slot identity controls rotation even when several slots reference the same segment. Optional library frame URLs resolve from durable Convex storage; the broadcaster never deletes these library assets. `src/schedule.ts` selects the next entry after the current run's accepted clip durations reach its budget, wrapping to the first. A boundary starts a fresh chain and clears history and casting. Empty schedules wait without generating unless a creator explicitly submits a scene. Only a creator-supplied image is uploaded; text-only openings use no frame. Later clips continue from their accepted predecessor. Clip-end flushing is disabled.

Before each action is enqueued, the Node supervisor asks Cerebras for a structured next-scene script. The planner sees the viewer direction and six most recent accepted generation prompts. Speculative summaries and separately generated dialogue are not fed back as observations. There is no default cast, voice or setting. A custom segment carries its creator's segment constitution and canonical character voice casting notes into every later planning call until explicitly replaced. The constitution defines the segment's durable vibe, format, world rules, identities, visual language, audio rules, and anti-drift constraints. It is never treated as a scene schedule. Voice casting stays separate from the constitution. Cerebras uses it to write in-character dialogue but must never copy its wording into dialogue. On the first plan for a cast, Cerebras compacts each speaker into a name (32 characters maximum) and acoustic description (64 maximum). A bounded process-local cache freezes these descriptions. `src/prompt-compiler.ts` assembles structured visual action, one optional speaker and quoted line, and a short soundscape. Only that speaker's voice is included, always outside dialogue; silent chunks spend no characters on voices. There is no production-note disclaimer. Dialogue is limited to approximately two words per second with two seconds reserved for a pause/action, capped at 22 words. The complete prompt must fit 800 characters without truncation. Invalid JSON, casting or budgets get one rewrite attempt within the same deadline; exhausted validation fails explicitly. The 1,800 completion-token allowance includes reasoning tokens. Cerebras invents the next causal beat from the viewer direction and newest accepted scene while keeping the constitution true. Planning uses the smaller of the configured timeout and the current chunk duration minus 250 ms, and the bridge keeps at most three clips outstanding. Each chunk continues the scene naturally without a mandatory pause. A planner failure rejects the plan rather than silently bypassing the script stage. If a claimed viewer prompt could not be planned, it is returned to pending. The bridge retries failed planning cycles in place with exponential delays of 2, 4, 8, 16 and then at most 30 seconds, while reporting degraded status and the next retry. There is one pending retry, no raw-prompt fallback, and no process restart for invalid or unavailable scene completions. A validated, accepted scene resets the retry count and resumes the same native chain. Buffered clip starts cannot mask that error. Successful retries clear it, and errors are logged by the supervisor.

The workshop has two playout modes. Queue Segment follows the normal pending order and appears in chat. Play From Start is a direct development action, creates no chat message, and is selected first by Convex. When the bridge claims it, the bridge pops every future clip from FastH3, releases their viewer prompts back to pending, enqueues the custom opening at generation position zero, and rebuilds its buffer from that segment. Once the opening is generated, it moves to the front of playout, stops the old clip, and retires its prompt so autoplay cuts to the new program without allowing the cancelled work to return. The currently generating clip may finish GPU work, but its result is discarded by FastH3.

Default chunk length comes from the Convex settings singleton. A library segment can override it with 6 to 14 seconds. On segment opening the Node planner resolves the override before calculating its deadline and dialogue budget, then returns the chosen duration to the bridge. Continuing chunks retain that run\'s override; inherited runs use the latest global default. The bridge uses the planned value for Reactor enqueue and duration accounting. Playback metadata carries that clip\'s chosen duration so the viewer countdown follows the on-air chunk, not the planning head. Scheduled boundaries and submitted segments start fresh chains and stamp segment identity, title, duration and actual playout time. The bridge counts accepted media duration, not generation wall time; admin edits apply on the next opening.

## Audience voting

The bounded accepted-clip map retains playback correlation until completion. A lifecycle event missing echoed metadata can still advance its vote and retire its prompt by accepted clip ID; unknown or discarded clip IDs cannot consume buffer capacity.

The Convex global interaction mode is `prompts` by default or `voting`. Voting claims only explicit development-priority prompts, leaving normal queued text untouched. The supervisor reads `voteDurationChunks` (default 2, range 1 to 12) and a durable ballot-planning decision before requesting a scene. `src/vote-options.ts` validates four distinct labels up to 48 characters and expanded directions up to 240 characters. Cerebras returns these with the scene in the same structured completion, grounded in its constitution and accepted history. The choice policy favors instantly readable character antics with distinct visual payoffs: a ridiculous power move, physical gag, harmless social disaster and character-specific wildcard. Every option must have a surprising payoff; a same-call self-check replaces routine looks, points and prop handling. Labels name an actor, strong action and recognizable target, not tiny acting notes. Directions preserve that visible promise within one chunk. Existing cast, props, world rules and buffer-tolerant timing still apply. Winner planning explicitly stages the chosen action instead of softening it into a glance or hesitation. It must not act out an unchosen option or speak the option list. The normal planner deadline, repair policy and 800-character compiled prompt cap still apply.

Each segment opening gets a fresh run UUID. Accepted clips register optional prepared ballots in Convex. `clip_started` opens the anchor ballot; deduplicated `clip_finished` events count its completed on-air chunks. Closing freezes the highest-vote option, using stable option order for ties. The next same-run planner claim consumes the winning expanded direction exactly once; failures release the claim. Acceptance marks it queued, and its actual start marks it playing and opens the next prepared ballot in one transaction. Serial playback writes finish before another planning request, preventing a queue-update race from skipping a newly closed round. Late accepted-clip registration reconciles with an already received start event.

The three-clip buffer and native continuation chain are unchanged. A winning beat follows already prepared media, not an immediate cut. Scheduled boundaries take precedence over old-run votes. Discarded future clips release their unused winning claim and cancel their prepared ballot. Restart/stop and changing to text mode cancel pending rounds. Opening, selection and airing publish protected Reactor TV chat records. Cancellation only updates ballot state, without a chat notice. Options and counts do not ride Reactor metadata; only run identity and the chosen direction's ordinary playback correlation fields do.

Lifecycle, bridge and planner tests use mocked transports and an in-memory Convex context. Live Cerebras choice latency and complete media handoff still require an authorized smoke test; a passing build is not proof of those outcomes.

## Local development

Custom segments are explicit `startsSegment` requests, not viewer continuations. They clear the previous chain and planner context. Text-only openings fetch and upload no frame. All segments continue until stopped or replaced. The opt-in `segments/the-office.json` experiment can be queued with the commands in `segments/README.md`.

The top-bar Debug button opens the local prompt inspector. It polls GET /api/dev/stream/prompts, which proxies the loopback supervisor's GET /control/prompts. The bounded process-local log holds the last 12 enqueue attempts and their clip lifecycle events. Text is the compiled model prompt, not the original viewer direction. Frame constraints are booleans only; metadata, uploaded files, image URLs and credentials are omitted. It is unavailable in production, does not write Convex, and does not renew the development lease. A running bridge needs a restart to begin emitting debug traces.

Local GET /control/media reports allowlisted incoming Reactor and outgoing LiveKit video statistics: dimensions, frame rate, frame/packet counters, jitter, freezes, and encoder limitation reasons. It is read-only, no-store, disabled outside manual development, and never renews the lease. No tokens, network addresses, or raw RTC reports are returned. The publisher uses `maintain-resolution` to avoid automatic pixel downscaling. Under resource or network pressure this can sacrifice frame rate, so stable dimensions alone do not establish smooth playback.

The default planner is `qwen-3.8-27b` with `CEREBRAS_REASONING_EFFORT=low`. `CEREBRAS_MODEL` remains overridable, including `gpt-oss-120b`. The choice follows a small synthetic scene-writing comparison, not a claim of general model superiority or measured video quality. See `PROMPTING.md` for fixtures, results and limitations.

Run the opt-in benchmark with credentials already in the environment:

```sh
pnpm --filter @reactor/infinite-broadcaster exec tsx scripts/benchmark-planner.ts
```

It makes 24 Cerebras scene plans across three fixtures and four model/effort variants. It prints synthetic prompts and wall-clock timings; it never enqueues video, touches the database or starts a stream. Pass specific `model:effort` arguments to narrow the comparison.

Follow the root README to configure your own Convex, LiveKit, Reactor, Cerebras and OpenAI accounts. Inject credentials into the process environment or configure the ignored local environment file yourself. The root `pnpm dev` command then starts this package with `BROADCASTER_MANUAL=1`. The supervisor binds to loopback and starts offline. The development-only player control calls the Next.js proxy, which calls `POST /control/start` or `POST /control/stop`. Starting opens the real bridge through the locally installed Google Chrome in the isolated `reactor-tv-dev` room. Page interactions renew a five minute idle lease through `POST /control/keepalive`. If that lease expires, or Stop stream is pressed, the supervisor closes the model and LiveKit session and resets any in-flight prompts. Railway continues to use the Chromium bundled in its Playwright container.

Add `CEREBRAS_API_KEY` to the ignored `webapp/.env.development.local` file before starting the local stream. Missing planner credentials do not stop the idle development server, but the Start stream action fails closed and names the missing variable.

`GET /control` reports the local control state. All control endpoints return 404 outside manual mode. Automatic status polling does not renew the idle lease.

## Real mode

Copy `.env.example` to a local ignored env source or inject its values through the process environment. Real mode requires Convex, LiveKit, Reactor, and Cerebras credentials. Then run:

```sh
pnpm --filter @reactor/infinite-broadcaster build
pnpm --filter @reactor/infinite-broadcaster start
```

The Railway container uses the repository root as its Docker build context because the broadcaster imports `packages/contracts`.

## Failure behavior

The production container starts `supervisor.ts`, which restarts a stopped worker
with 1, 2, 4, 8, 16 and then at most 30 seconds of backoff, without a finite retry
budget. A worker running for at least one minute resets the backoff; that timer
does not assert healthy playback. Terminal bridge and safety failures retain the
ten-second watchdog and exit the worker. Playwright's normal process-exit handler
kills its owned Chromium process group. The next worker creates a fresh model
session and reconciles only existing in-flight queue state. Blocked prompts stay
blocked, and every generated scene still passes moderation.

SIGINT/SIGTERM to the parent cancels pending restarts and forwards SIGTERM to the
worker. Shutdown is bounded at eight seconds; an unresponsive worker is killed
before the parent exits. An unexpected unhandled worker signal also exits the
parent, so the container is replaced rather than retaining orphan browsers.
Railway's `Always` policy remains the fallback for parent/container failures.
Intentional maintenance stops the service or parent, not just its worker.
Outage monitoring and actual-media health remain independent of this recovery.

Production samples `window.mediaHealth` every two seconds without overlapping
requests. `media-health.ts` requires advancing Reactor decoded and LiveKit encoded
video frames on existing RTP streams, connected peers, an unmuted live video track,
and active clip playback bounded by its accepted duration. The sample timestamp is
taken before browser I/O so a delayed reply cannot renew health. Node sends only
the boolean result, observation time and session start to the secret-protected
Convex `streamAlerts.pulse` endpoint. Failures never block generation. Manual
development does not sample or report; page closure clears the timer.

Convex, not this process, owns the optional five-minute outage deadline and Slack
delivery. Deploy the new backend before the publisher. Monitoring is disabled by
default and must be explicitly enabled with a verified channel webhook. This does
not change the public heartbeat expiry or restart policy. See
[OUTAGE_ALERTS.md](../../OUTAGE_ALERTS.md) for activation and coverage limits.

Reactor credentials are provided through the SDK's per-request async JWT resolver. The Node supervisor caches them per bridge, deduplicates concurrent refreshes, reads the signed token's expiry for scheduling only, and renews 60 seconds early. Startup permits one model session. Once the SDK reports its session id, subsequent tokens are bound to that exact session and cannot switch to another. Token requests time out after 10 seconds. No master key, token or token response is logged, and obsolete bridge pages cannot retrieve credentials.

An opening-frame upload rejected with HTTP 401 forces one refresh and retries that upload in the same session. Accepted generation commands are never replayed. During this bounded recovery the upload promise owns any matching SDK error event, preventing a redundant restart watchdog. Failed renewal, a second rejection and non-authentication failures still surface explicitly through the existing terminal path. Normal credential expiry does not consume Railway's restart allowance.

The opt-in `scripts/check-token-refresh.ts` integration check opens one disposable real Reactor session, uploads a tiny synthetic image, injects one invalid credential, and verifies upload recovery after renewal with the same session id. It generates no video, connects to neither Convex nor LiveKit, and disconnects afterward. Run from this package with `REACTOR_API_KEY` already in the environment: `node --import tsx scripts/check-token-refresh.ts`. It requires local Chrome and can incur brief session usage. Unit tests simulate 48 hours of expiry and concurrency without remote calls.

- Startup resets queued and playing prompts to pending through the status index, without reading completed prompt history, then derives work again from Convex. Creation order, content, author attribution and star totals stay unchanged. Reconciliation and bridge-launch failures release startup state so manual development can try again.
- An empty startup queue waits. Text-only openings use no frame; image-backed openings use only the submitted frame. Failed generation degrades explicitly rather than introducing a fallback show.
- Cerebras planning must finish before `CEREBRAS_TIMEOUT_MS`, which must be shorter than `CLIP_SECONDS`.
- The process reports offline, starting, live, or degraded status through heartbeats.
- Convex marks a stale heartbeat offline after 45 seconds.
- `/health` returns 503 while degraded so the deployment is observable.
- Recoverable planning degradation sends the explicit retrying classification and never arms the process-exit watchdog. Production startup failures, including the initial heartbeat and prompt reconciliation, arm the same watchdog before error-heartbeat I/O. The health server and heartbeat interval cannot keep a failed startup alive indefinitely. Session, media and playback-state failures use the restart classification (the default), with 10 seconds to recover before a logged exit. The watchdog is updated before asynchronous heartbeat I/O; a delayed write cannot rearm a cleared exit timer. Stop/shutdown clear it, and manual development never exits automatically.
- A normal worker exit is restarted by the in-container supervisor; parent/container failure uses Railway's restart policy. Repeated planning failures stay inside the bridge rather than replacing its worker.

Scene planning retries one isolated timeout with the same claimed direction. Invalid plans and refusals are not retried by this transport wrapper. Each attempt retains its configured deadline; two consecutive timeouts report Cerebras explicitly. Three outstanding clips allow planning to overlap queued generation, but exhausted buffering can still stall.

## Viewer text priority

Ordinary viewer text is the primary creative direction for its chunk. The supervisor classifies ordinary prompt submissions explicitly; author names and prompt wording cannot select that policy. The requested event, subjects, intensity and scale override conflicting segment realism, tone, pacing and other creative restrictions. JSON, compiler budgets, fixed voice definitions and application-controlled geometry remain mandatory. The planner is told to lead with a visible event and self-check fidelity in the same answer, without adding a model call or claiming a semantic guarantee. After enqueue acceptance, the bridge carries the four most recent viewer requests for the current segment into later plans. Newer conflicting requests take precedence; continuations develop consequences rather than replaying onsets or restoring the original scene. New segments clear that context. This context records intentions, not observed footage, and remains process-local.

## Viewer prompt admission

### Defense before generation

Every compiled scene passes the secret-protected Convex `prompts.checkScene` action before enqueue. The existing Convex OpenAI credential checks the exact output and original queued source against current Admin criteria; a transactional completion rejects stale policy revisions or retired sources. Automatic continuations, scheduled openings and voting results receive the same output check. Unavailable checks fail closed and retry without enqueue. Rejected viewer sources are quarantined, and the bridge requests a fresh session to discard unsafe continuation history. Safety is a fixed higher-priority instruction in Cerebras, not a segment preference viewers can override. Cast descriptions stay in the untrusted user payload.

The shared encoding guard rejects opaque byte/character payloads and high-confidence safety overrides at submission and claim, including historical queued requests. Convex retains blocked rows as evidence and never releases them back to pending. Ordinary pending admissions have a global bound of 64 to limit multi-identity queue flooding. This is not authenticated user identity or comprehensive bot protection.

Deploy Convex first, run internal `prompts.quarantineUnsafe` until it reports no matching active rows, then replace the bridge so old native frames and accepted-request history cannot survive the release. No prompt or message deletion is needed. The output classifier adds a bounded call per chunk and can increase planning latency. It checks instructions, not actual generated pixels, so it is not a guarantee against model-generated explicit frames.

Run the opt-in text-only `node --import tsx scripts/check-prompt-safety.ts` with an existing `OPENAI_API_KEY` to verify permitted creativity, encoded inputs, sexual euphemisms, final-scene rejection and additional criteria against the real classifier. It generates no video and writes no Convex state. Output contains fixture labels and verdicts, not keys or private prompts.

Convex prompts.submit moderates ordinary viewer requests before writing any claimable prompt or shared chat record. The broadcaster and Cerebras see only the admitted queue; no moderation provider call or credential is added to this process. Admission does not change approved viewer text's creative precedence. Trusted Admin/workshop segments and generated ballots retain their own paths. The gate and its private checking/rejection UI are documented in webapp/README.md.
