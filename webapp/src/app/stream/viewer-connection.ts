import { DisconnectReason, Room, RoomEvent, Track, VideoQuality, type RemoteTrack, type RemoteTrackPublication } from "livekit-client";

type Options = {
  identity: string;
  audio: () => HTMLAudioElement | null;
  video: () => HTMLVideoElement | null;
  onConnection: (state: "connecting" | "live" | "offline") => void;
  onCount: (count: number) => void;
  onRoom: (room: Room | null) => void;
  createRoom?: () => Room;
  fetchToken?: typeof fetch;
  retryDelayMs?: number;
};

/** Rejoin with a fresh token after a terminal disconnect or failed initial join. */
export function connectViewer(options: Options): () => void {
  let disposed = false;
  let current: Room | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let clearVideoListener = () => {};
  let failures = 0;

  const retire = () => {
    clearVideoListener();
    if (!current) return;
    const room = current;
    current = null;
    room.removeAllListeners();
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) publication.track?.detach();
    }
    options.onRoom(null);
    void room.disconnect();
  };

  const schedule = (room: Room, reconnect = true) => {
    if (disposed || room !== current) return;
    retire();
    options.onConnection("offline");
    if (reconnect) retry = setTimeout(() => void join(), Math.min(10_000, (options.retryDelayMs ?? 1000) * 2 ** failures++));
  };

  const join = async () => {
    if (disposed) return;
    const room = (options.createRoom ?? (() => new Room({ adaptiveStream: false, dynacast: false })))();
    current = room;
    options.onRoom(room);
    options.onConnection("connecting");
    const valid = () => !disposed && current === room;
    const count = () => {
      if (valid()) options.onCount(1 + [...room.remoteParticipants.values()].filter(p => p.identity !== "streamer").length);
    };
    const attach = (track: RemoteTrack, publication: RemoteTrackPublication) => {
      if (!valid()) return;
      if (track.kind === Track.Kind.Audio) {
        const audio = options.audio();
        if (audio) track.attach(audio);
      } else if (track.kind === Track.Kind.Video) {
        publication.setVideoQuality(VideoQuality.HIGH);
        publication.setEnabled(true);
        const video = options.video();
        if (!video) return;
        clearVideoListener();
        const playable = () => {
          if (valid() && video.readyState >= 2 && video.videoWidth > 0) options.onConnection("live");
        };
        video.addEventListener("loadeddata", playable);
        video.addEventListener("playing", playable);
        clearVideoListener = () => {
          video.removeEventListener("loadeddata", playable);
          video.removeEventListener("playing", playable);
        };
        track.attach(video);
        void video.play().catch(() => undefined);
        playable();
      }
    };
    room.on(RoomEvent.TrackSubscribed, attach);
    room.on(RoomEvent.TrackUnsubscribed, track => {
      track.detach();
      if (valid() && track.kind === Track.Kind.Video) {
        clearVideoListener();
        options.onConnection("connecting");
      }
    });
    room.on(RoomEvent.ParticipantConnected, count);
    room.on(RoomEvent.ParticipantDisconnected, count);
    room.on(RoomEvent.Reconnecting, () => { if (valid()) options.onConnection("connecting"); });
    room.on(RoomEvent.Reconnected, () => { if (valid()) { count(); rescan(); } });
    room.on(RoomEvent.Disconnected, reason => schedule(room, reason !== DisconnectReason.DUPLICATE_IDENTITY));
    const rescan = () => {
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          if (publication.track) attach(publication.track, publication);
        }
      }
    };
    try {
      const response = await (options.fetchToken ?? fetch)(`/api/livekit/token?identity=${options.identity}`, {
        cache: "no-store", signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("LiveKit token unavailable");
      const { url, token } = await response.json() as { url: string; token: string };
      if (!valid()) return;
      await room.connect(url, token, { autoSubscribe: true });
      if (!valid()) { void room.disconnect(); return; }
      failures = 0;
      count();
      rescan();
    } catch {
      schedule(room);
    }
  };
  void join();
  return () => { disposed = true; clearTimeout(retry); retire(); };
}
