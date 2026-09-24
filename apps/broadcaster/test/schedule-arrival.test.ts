import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { batchScheduleNotice, ScheduleArrivals, scheduleNoticeFlight, scheduleNoticePosition, SCHEDULE_NOTICE_FLIGHT_MS, SCHEDULE_NOTICE_HOLD_MS, SCHEDULE_NOTICE_PULSE_MS } from "../../../webapp/src/lib/schedule-arrival";
import { promptPreview } from "../../../webapp/src/lib/on-air-prompt";

const prompt = (_id: string, time: number, status = "pending") => ({ _id, text: `A tiny storm cloud follows ${_id} around the room`, createdAt: time, _creationTime: time, status });

test("schedule arrivals ignore loading and the initial queue, then announce new waiting prompts", () => {
  const tracker = new ScheduleArrivals();
  assert.deepEqual(tracker.observe(undefined), []);
  assert.deepEqual(tracker.observe([prompt("existing", 1)]), []);
  assert.deepEqual(tracker.observe([prompt("existing", 1), prompt("new", 2)]).map(p => p._id), ["new"]);
  assert.deepEqual(tracker.observe([prompt("new", 2), prompt("existing", 1)]), []);
  assert.deepEqual(tracker.observe([prompt("new", 2, "queued"), prompt("existing", 1, "playing")]), []);
  assert.deepEqual(tracker.observe([]), []);
  assert.deepEqual(tracker.observe([prompt("existing", 1)]), [], "Recovery must not replay an old prompt toast");
});

test("creation ties, simultaneous arrival/departure and server creation order stay distinct", () => {
  const tracker = new ScheduleArrivals();
  tracker.observe([]);
  assert.equal(tracker.observe([prompt("a", 1)]).length, 1);
  assert.deepEqual(tracker.observe([prompt("b", 1)]).map(p => p._id), ["b"]);
  assert.deepEqual(tracker.observe([prompt("a", 1), prompt("b", 1)]), []);
  const serverTime = { ...prompt("c", 0), _creationTime: 1.5 };
  assert.deepEqual(tracker.observe([serverTime]).map(p => p._id), ["c"]);
  assert.deepEqual(tracker.observe([prompt("d", 3), prompt("e", 2)]).map(p => p._id), ["d", "e"]);
  assert.deepEqual(tracker.observe([prompt("d", 3), prompt("e", 2)]), []);
});

test("playing, private statuses, and immediate workshop overrides never get scheduled toasts", () => {
  const tracker = new ScheduleArrivals();
  tracker.observe([]);
  assert.deepEqual(tracker.observe([
    prompt("playing", 1, "playing"), prompt("played", 2, "played"), prompt("rejected", 3, "rejected"),
    { ...prompt("override", 4), playNow: true },
  ]), []);
  assert.deepEqual(tracker.observe([prompt("playing", 1)]), []);
});

test("hidden, disconnected, and open-schedule snapshots are consumed without later replay", () => {
  const tracker = new ScheduleArrivals();
  tracker.observe([]);
  assert.deepEqual(tracker.observe([prompt("hidden", 1)], false), []);
  assert.deepEqual(tracker.observe([prompt("hidden", 1)]), []);
  assert.deepEqual(tracker.observe([prompt("hidden", 1), prompt("visible", 2)]).map(p => p._id), ["visible"]);
  assert.deepEqual(tracker.observe(undefined), []);
  assert.deepEqual(tracker.observe([prompt("reconnected", 3)]), []);
});

test("bursts retain one readable excerpt and a bounded aggregate instead of stacking cards", () => {
  const first = batchScheduleNotice(null, [prompt("a", 1), prompt("b", 2)])!;
  const second = batchScheduleNotice(first, Array.from({ length: 100 }, (_, i) => prompt(String(i), i + 3)))!;
  assert.equal(first.count, 2);
  assert.equal(second.count, 102);
  assert.equal(second.text, first.text);
  assert.equal(second.id, first.id);
  assert.equal(batchScheduleNotice(second, []), second);
  assert.equal(batchScheduleNotice(null, []), null);
  assert.equal(promptPreview(first.text), "A tiny storm cloud follows a around the…");
  assert.ok(SCHEDULE_NOTICE_HOLD_MS >= 1000, "Keep a moment to read the short excerpt");
  assert.ok(SCHEDULE_NOTICE_HOLD_MS + SCHEDULE_NOTICE_FLIGHT_MS + SCHEDULE_NOTICE_PULSE_MS < 2000, "The entire notice should be fleeting");
});

test("flight curves into the actual button center and fades as it contracts", () => {
  for (const [x, y] of [[60, -70], [-60, -160], [0, -200], [120, 40]]) {
    const frames = scheduleNoticeFlight(x, y);
    assert.equal(frames.length, 13);
    assert.equal(frames[0].transform, "translate(0px, 0px) rotate(0deg) scale(1)");
    assert.equal(frames[0].opacity, 1);
    const last = frames.at(-1)!;
    assert.ok(last.transform.startsWith(`translate(${x}px, ${y}px)`));
    assert.equal(last.opacity, 0);
    assert.equal(last.offset, 1);
    const midpoint = frames[6].transform.match(/translate\(([^p]+)px, ([^p]+)px\)/)!;
    assert.ok(Math.hypot(Number(midpoint[1]) - x / 2, Number(midpoint[2]) - y / 2) > 10, "Travel must not be a straight shrink");
    frames.forEach((frame, index) => {
      assert.ok(Number.isFinite(frame.opacity));
      if (index) assert.ok(frame.opacity <= frames[index - 1].opacity);
      assert.doesNotMatch(frame.transform, /NaN|Infinity/);
    });
  }
});

test("the visual toast is a single translucent quoted excerpt with no explanatory heading", () => {
  const source = readFileSync(resolve("../../webapp/src/app/stream/schedule-arrival-toast.tsx"), "utf8");
  const css = readFileSync(resolve("../../webapp/src/app/stream/schedule-arrival-toast.css"), "utf8");
  assert.doesNotMatch(source, /schedule-arrival-title|RiArrowRightUpLine/);
  assert.match(source, /scheduleNoticeFlight\(x, y\)/);
  assert.match(source, /\$\{title\}: \$\{excerpt\}/, "Screen readers retain the schedule context that motion implies visually");
  for (const rule of ['padding: 5px 9px', 'min-height: 30px', '58%, transparent', 'white-space: nowrap', 'text-overflow: ellipsis', 'content: "“"', 'content: "”"']) {
    assert.ok(css.includes(rule), rule);
  }
  assert.doesNotMatch(css, /flex-direction: column|min-height: 68px|line-clamp/);
});

test("toast positioning stays in the viewport and below the complete responsive control strip", () => {
  for (const width of [320, 390, 768, 1024, 1440, 1920, 3840]) {
    const size = { width: Math.min(280, width - 24), height: 30 };
    const viewport = { width, height: 800 };
    const point = scheduleNoticePosition({ right: width - 24, bottom: 110 }, 220, size, viewport);
    assert.ok(point.left >= 12);
    assert.ok(point.left + size.width <= width - 12);
    assert.equal(point.top, 232);
  }
  const edge = scheduleNoticePosition({ right: 20, bottom: 790 }, 790, { width: 280, height: 80 }, { width: 320, height: 800 });
  assert.deepEqual(edge, { left: 12, top: 708 });
});

test("notification lifecycle has no polling, preserves focus, honors motion changes and cleans up", () => {
  const source = readFileSync(resolve("../../webapp/src/app/stream/schedule-arrival-toast.tsx"), "utf8");
  assert.doesNotMatch(source, /fetch\(|setInterval|autoFocus/);
  for (const code of [
    'createPortal(', 'document.body', 'role="status"', 'aria-live="polite"',
    'enabled && !document.hidden', 'document.removeEventListener("visibilitychange", visibility)',
    '!hovering && !focused', 'card.addEventListener("pointerenter", enter)', 'card.addEventListener("focus", focus)',
    'preference.matches || !card.animate', 'preference.addEventListener("change", reduceMotion)',
    'preference.removeEventListener("change", reduceMotion)', 'animation.cancel()', 'resize.disconnect()',
    'const from = card.getBoundingClientRect()', 'const to = anchor.getBoundingClientRect()',
    'if (document.activeElement === card) anchor.focus({ preventScroll: true })',
    'anchorRef.current?.focus({ preventScroll: true })', 'card.inert = true',
  ]) assert.ok(source.includes(code), code);
});
