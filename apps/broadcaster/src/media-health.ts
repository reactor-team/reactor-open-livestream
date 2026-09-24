export type VideoCounter = { id: string; frames: number };
export type MediaHealthSample = {
  connected: boolean;
  playing: boolean;
  incoming: VideoCounter[];
  outgoing: VideoCounter[];
};

/** Both sides must advance on an existing RTP stream, not merely have a track. */
export function createMediaProgressProbe() {
  let previous: MediaHealthSample | undefined;
  const advances = (now: VideoCounter[], before: VideoCounter[]) => now.some(counter =>
    Number.isSafeInteger(counter.frames) && counter.frames > 0
    && before.some(old => old.id === counter.id && counter.frames > old.frames));
  return (sample: MediaHealthSample): boolean => {
    const healthy = Boolean(previous && sample.connected && sample.playing
      && advances(sample.incoming, previous.incoming) && advances(sample.outgoing, previous.outgoing));
    previous = sample;
    return healthy;
  };
}
