import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as wait } from "node:timers/promises";

import { createIdleLease } from "../src/idle-lease";

test("idle lease expires once after the latest renewal", async () => {
  let expirations = 0;
  const lease = createIdleLease({
    timeoutMs: 20,
    onExpire: () => {
      expirations += 1;
    },
  });

  lease.renew();
  await wait(10);
  lease.renew();
  await wait(15);
  assert.equal(expirations, 0);
  await wait(15);
  assert.equal(expirations, 1);
});

test("clearing the idle lease prevents expiration", async () => {
  let expired = false;
  const lease = createIdleLease({ timeoutMs: 10, onExpire: () => { expired = true; } });
  lease.renew();
  lease.clear();
  await wait(20);
  assert.equal(expired, false);
});
