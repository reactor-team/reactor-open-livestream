import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { processRestartDelay, superviseProcess } from "../src/process-supervisor";

class Worker extends EventEmitter {
  signals: NodeJS.Signals[] = [];
  kill(signal: NodeJS.Signals) { this.signals.push(signal); return true; }
  close(code = 1, signal: NodeJS.Signals | null = null) { this.emit("close", code, signal); }
}

function fixture(throwOnFirstSpawn = false) {
  let now = 0;
  let attempts = 0;
  const workers: Worker[] = [];
  const exits: number[] = [];
  const timers = new Set<{ run: () => void; at: number; delay: number }>();
  const supervisor = superviseProcess({
    spawnChild() {
      if (++attempts === 1 && throwOnFirstSpawn) throw new Error("fixture");
      const worker = new Worker(); workers.push(worker); return worker;
    },
    onStopped: code => exits.push(code), log() {}, now: () => now,
    schedule(run, delay) {
      const timer = { run, at: now + delay, delay }; timers.add(timer);
      return () => { timers.delete(timer); };
    },
  });
  return { ...supervisor, workers, exits, timers, tick(ms: number) {
    now += ms;
    for (const timer of [...timers]) if (timer.at <= now) { timers.delete(timer); timer.run(); }
  } };
}

test("more than ten terminal failures keep recovering with capped backoff and one worker", () => {
  const f = fixture();
  for (let attempt = 1; attempt <= 20; attempt++) {
    assert.equal(f.workers.length, attempt);
    f.workers.at(-1)!.close();
    assert.equal(f.timers.size, 1);
    const delay = [...f.timers][0].delay;
    assert.equal(delay, processRestartDelay(attempt));
    f.tick(delay - 1);
    assert.equal(f.workers.length, attempt, "never overlap with the previous worker");
    f.tick(1);
  }
  assert.equal(f.workers.length, 21);
  assert.deepEqual(f.exits, []);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 1000].map(processRestartDelay), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
});

test("a minute of worker uptime resets restart backoff, not broadcast health", () => {
  const f = fixture();
  f.workers[0].close(); f.tick(1000);
  f.workers[1].close(); f.tick(2000);
  f.tick(60_000);
  f.workers[2].close();
  assert.equal([...f.timers][0].delay, 1000);
});

test("unexpected successful exit also restarts the continuous production worker", () => {
  const f = fixture(); f.workers[0].close(0); f.tick(1000);
  assert.equal(f.workers.length, 2);
  assert.deepEqual(f.exits, []);
});

test("spawn errors and their following close schedule exactly one retry", () => {
  const f = fixture();
  f.workers[0].emit("error", new Error("fixture"));
  assert.equal(f.timers.size, 0);
  f.workers[0].close(-2); f.workers[0].close(-2);
  assert.equal(f.timers.size, 1);
  f.tick(1000);
  f.workers[0].close();
  assert.equal(f.timers.size, 0, "obsolete worker events cannot restart a new worker");
  assert.equal(f.workers.length, 2);
  const thrown = fixture(true); thrown.tick(1000);
  assert.equal(thrown.workers.length, 1);
});

test("operator stop cancels a pending restart and never launches again", () => {
  const f = fixture(); f.workers[0].close(); f.stop(); f.stop(); f.tick(120_000);
  assert.equal(f.workers.length, 1);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.exits, [0]);
});

test("operator stop forwards one SIGTERM and waits for clean worker shutdown", () => {
  const f = fixture(); f.stop(); f.stop();
  assert.deepEqual(f.workers[0].signals, ["SIGTERM"]);
  assert.deepEqual(f.exits, []);
  f.workers[0].close(0); f.tick(120_000);
  assert.deepEqual(f.exits, [0]);
  assert.equal(f.workers.length, 1);
  assert.equal(f.timers.size, 0);
});

test("a hung shutdown is bounded and does not resurrect the worker", () => {
  const f = fixture(); f.stop(); f.tick(7999);
  assert.deepEqual(f.exits, []);
  f.tick(1);
  assert.deepEqual(f.workers[0].signals, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(f.exits, [0]);
  f.workers[0].close(0, "SIGKILL"); f.tick(120_000);
  assert.deepEqual(f.exits, [0]);
  assert.equal(f.workers.length, 1);
});

test("an unhandled worker signal replaces the container to clean orphan browsers", () => {
  for (const signal of ["SIGKILL", "SIGSEGV"] as const) {
    const f = fixture(); f.workers[0].close(1, signal); f.tick(120_000);
    assert.deepEqual(f.exits, [1]);
    assert.equal(f.workers.length, 1);
    assert.equal(f.timers.size, 0);
  }
});

test("real safety-watchdog exits start fresh processes without Railway", { timeout: 15_000 }, async (t) => {
  const pids: number[] = [];
  const children: ReturnType<typeof spawn>[] = [];
  let resolveReady!: () => void;
  let resolveStopped!: (code: number) => void;
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });
  const stopped = new Promise<number>(resolve => { resolveStopped = resolve; });
  const supervisor = superviseProcess({
    log() {},
    spawnChild() {
      const terminal = children.length < 2;
      const script = terminal ? `
        import { createFailureWatchdog } from './src/failure-watchdog.ts';
        console.log('ready');
        createFailureWatchdog({manual:false,delayMs:5,onExpire:()=>process.exit(1)})
          .update('degraded','restart');
        setInterval(()=>{},1000);
      ` : `process.on('SIGTERM',()=>process.exit(0));console.log('ready');setInterval(()=>{},1000);`;
      const worker = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
      children.push(worker);
      if (worker.pid) pids.push(worker.pid);
      worker.stdout!.on("data", () => { if (!terminal) resolveReady(); });
      return worker;
    },
    onStopped: resolveStopped,
    schedule(run, delay) {
      const timer = setTimeout(run, delay === 8000 ? 1000 : 5);
      return () => clearTimeout(timer);
    },
  });
  t.after(() => { supervisor.stop(); for (const child of children) if (child.exitCode === null) child.kill("SIGKILL"); });
  await ready;
  assert.equal(pids.length, 3);
  assert.equal(new Set(pids).size, 3, "no old process, token cache or native continuation is reused");
  assert.deepEqual(children.slice(0, 2).map(child => child.exitCode), [1, 1]);
  supervisor.stop();
  assert.equal(await stopped, 0);
  assert.equal(children.length, 3, "intentional stop cannot create a fourth model session");
});

test("production entrypoints use supervision and manual development stays direct", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const docker = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  const build = await readFile(new URL("../scripts/build.ts", import.meta.url), "utf8");
  assert.equal(pkg.scripts.start, "node dist/supervisor.js");
  assert.match(pkg.scripts["dev:server"], /--watch dist\/server\.js/);
  assert.match(docker, /CMD \["node", "apps\/broadcaster\/dist\/supervisor\.js"\]/);
  assert.match(build, /src\/supervisor\.ts/);
});
