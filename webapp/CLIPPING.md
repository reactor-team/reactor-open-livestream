# Browser clipping

The viewer's Clip control sits beside fullscreen. Watch for a few seconds, open it, preview recent playback, trim with the filmstrip handles or duration presets, name the file and download an MP4. Drag the selected region's middle to slide it without changing its length. Nothing is posted to chat or uploaded to a remote service.

The editor keeps visible copy to controls, timing, progress and actionable errors. It has no subtitle, preview watermark, duplicated selection duration, visible instructions or explanatory footer. Keyboard guidance remains screen-reader-only. Export progress appears in the download button; completion reads Download ready.

## Implementation

- `src/lib/live-clip-buffer.ts` records cloned subscriber video/audio tracks into complete 12-second blocks. It retains at most six completed blocks and 60 MB, plus one in-progress block capped at 12 MB. It never stops the original LiveKit tracks.
- `src/app/stream/clip-controls.tsx` records only during visible live playback. Hiding the tab, disconnecting or reloading resets its history. Each editor opening freezes a snapshot while the live stream continues. Closing aborts pending work, releases preview URLs and restores the live audio element's mute state.
- `src/lib/clip-client.ts` lazy-loads the browser media adapter only on capture/export and applies a two-minute deadline. No clip POST, secret or remote API is involved.
- `src/lib/browser-clip-export.ts` uses Mediabunny to join complete recording blocks without re-encoding. It retains the newest complete blocks fitting within 60 seconds, typically 48 to 60 seconds after watching for a minute. Audio/video timestamps share the same per-block offset. Unknown or changed codecs and unreadable media produce a retry message, never a silently broken download.
- Export transcodes the selected range to H.264/AAC MP4 using WebCodecs, retaining the video dimensions and audio when present. A lazy-loaded bundled AAC encoder covers browsers without native AAC encoding. Missing video codec support reports a clear browser-compatibility message. Media and filenames stay on the device.
- `src/app/stream/clip-editor.tsx` provides playback, pointer/keyboard trim handles, 15/30/60-second presets and download progress. Drag the middle to move the whole range, clamped at both ends. Left/Right moves it 0.1 seconds, Shift moves one second, and Home/End moves to the bounds. Movement pauses preview and seeks to the new start. Releasing a drag outside the dialog does not dismiss it. Close, Escape and a true backdrop click still dismiss it.
- Edits are disabled during export. Closing cancels conversion and frees media resources. Errors retain the selection so viewers can retry or shorten it. Decoder, encoder and input resources are disposed after each operation. Unsupported MediaRecorder browsers show an actionable notice.

## Limits

History begins when this tab watches, not before arrival. It is a bounded in-memory recording of received LiveKit media, not the original model recording, a DVR or an archive. Block boundaries can have small capture discontinuities. Downloads require an encoding pass and device/browser codec support; export speed varies by device. Frame and audio-packet rounding can add a small fraction of a second to the selected duration. There is no permanent URL, gallery, shared history or remote storage.

The fal.live page was inspected after its entry gate, but the version available during inspection exposed no clipping control. This is a Reactor-native editor reviewed locally by the user, not a verified replica of an unseen fal editor or a copy of proprietary source. The existing Aeonik/Dune styling follows the [Reactor brand master](https://www.figma.com/design/tF05tESyAM94KcjflwE0W0).

## Development reference

`POST /api/dev/clips` is an unused development-only FFmpeg/FFprobe comparison adapter. It checks matching loopback Origin/Host, caps input bytes and file count, permits one export at a time, uses fixed temporary names and deletes its temporary directory on success/failure. Production returns 404. No FFmpeg binary is needed by the deployed website. `local-request.ts` also fixes the development backend selector's Origin/Host comparison when Next internally binds `0.0.0.0`.

## Verification

Run `CLIP_FFMPEG_TEST=1 pnpm --filter @reactor/infinite-broadcaster test` with FFmpeg/FFprobe installed for media integration checks. Tests cover trim bounds, duration-preserving translation, edge clamping, filenames, loopback checks, buffer limits and track ownership. Real WebM fixtures without declared durations are assembled in browser-compatible code, decoded and checked for retained video/audio tracks; the reference export produces trimmed H.264/AAC MP4.

Browser verification covers pointer drags in both directions, both boundaries, outside-dialog release, keyboard movement and independent edge trimming. The original editor passed 320, 433, 820 and 1440 CSS pixel layout checks. A 15-second browser-only export measures 15.082667 seconds, retains 1344 x 768 video and contains non-silent 48 kHz AAC audio. Typechecks, lint, production build and all 196 tests pass before release.

## Future shared clips

Original-quality or shared clips should use [Reactor's recording API](https://docs.reactor.inc/concepts/recordings) through the broadcaster's active session. That requires a bounded authenticated request, retrieval/export ownership, storage, retention and abuse controls. Never expose the session account JWT or Reactor key or start a model session per viewer. Recording URLs expire after 24 hours and are not permanent share links. Those services are not part of this download-only release.

Media adapter references: [reading/writing media](https://mediabunny.dev/guide/writing-media-files), [conversion and trimming](https://mediabunny.dev/guide/converting-media-files).
