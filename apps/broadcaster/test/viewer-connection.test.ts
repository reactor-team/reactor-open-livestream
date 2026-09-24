import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { RoomEvent, Track, type Room } from "livekit-client";
import { connectViewer } from "../../../webapp/src/app/stream/viewer-connection";

test("viewer retries failed startup and reconnects without a refresh; live waits for video data", async t => {
  class FakeRoom extends EventEmitter {
    remoteParticipants = new Map();
    async connect() {}
    async disconnect() {}
  }
  class FakeVideo extends EventTarget {
    readyState = 0;
    videoWidth = 0;
    async play() {}
  }
  const rooms: FakeRoom[] = [];
  const video = new FakeVideo();
  const states: string[] = [];
  let fetches = 0;
  let attachments = 0;
  let detached = 0;
  const stop = connectViewer({
    identity: "test", audio: () => null, video: () => video as unknown as HTMLVideoElement,
    onConnection: state => states.push(state), onCount: () => {}, onRoom: () => {},
    createRoom: () => { const room = new FakeRoom(); rooms.push(room); return room as unknown as Room; },
    fetchToken: async () => ++fetches === 1 ? new Response(null, { status: 503 }) : Response.json({ url: "test", token: "test" }),
    retryDelayMs: 1,
  });
  t.after(stop);
  const waitForRooms = async (count: number) => {
    for (let i = 0; i < 100 && rooms.length < count; i++) await new Promise(resolve => setTimeout(resolve, 2));
    assert.equal(rooms.length, count);
  };
  await waitForRooms(2);
  const track = { kind: Track.Kind.Video, attach: () => { attachments++; }, detach: () => { detached++; } };
  const publication = { track, setVideoQuality: () => {}, setEnabled: () => {} };
  rooms[1].remoteParticipants.set("streamer", { identity: "streamer", trackPublications: new Map([["video", publication]]) });
  rooms[1].emit(RoomEvent.TrackSubscribed, track, publication);
  assert.equal(states.includes("live"), false, "subscription alone is not playable video");
  video.readyState = 2;
  video.videoWidth = 1344;
  video.dispatchEvent(new Event("loadeddata"));
  assert.equal(states.at(-1), "live");
  assert.ok(attachments > 0);
  rooms[1].emit(RoomEvent.Disconnected);
  await waitForRooms(3);
  assert.ok(detached > 0);
  stop();
  rooms[2].emit(RoomEvent.Disconnected);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(rooms.length, 3, "unmount stops reconnect attempts");
});
