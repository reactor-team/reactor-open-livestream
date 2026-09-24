# Office starter scene

The default seed is an original office comedy with three fictional coworkers, a suggestion box, and one stable room. No third-party characters, images or recordings are bundled.

Source: [`webapp/convex/lib/officeSeed.ts`](../webapp/convex/lib/officeSeed.ts).

After configuring your own development Convex backend:

```sh
pnpm seed:office
```

This creates one editable library segment and one enabled five-minute schedule slot. Repeated calls preserve edits and do not duplicate or re-enable the seed. It does not generate video.

Open [Admin > Schedule](http://localhost:3000/admin) to edit, disable, remove from rotation or replace it. `pnpm seed:remove-office` deletes only the seed segment and its schedule entries. Stop the local stream first if you want it gone immediately from playback; already-buffered clips are otherwise allowed to finish. No startup hook restores it.
