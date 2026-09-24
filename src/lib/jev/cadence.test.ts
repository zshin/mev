import assert from "node:assert/strict";
import test from "node:test";

import { LIVE_HEARTBEAT_MS, LIVE_MIN_GAP_MS, liveCallDue, type TapeSignature } from "@/lib/jev/cadence";

const quiet: TapeSignature = { regime: "chop", momentumBps: 0.2, imbalance: 0.02, shockBps: 0.1 };

function due(overrides: Partial<Parameters<typeof liveCallDue>[0]> = {}): boolean {
  return liveCallDue({
    now: 10_000,
    lastCallAt: 10_000,
    notBefore: 0,
    inFlight: false,
    previous: quiet,
    next: quiet,
    ...overrides,
  });
}

test("the first armed call is due, and an in-flight call is not", () => {
  assert.equal(due({ lastCallAt: 0, previous: null }), true);
  assert.equal(due({ inFlight: true, lastCallAt: 0 }), false);
});

test("a quiet tape waits for the heartbeat", () => {
  assert.equal(due({ lastCallAt: 10_000 - LIVE_MIN_GAP_MS }), false);
  assert.equal(due({ lastCallAt: 10_000 - LIVE_HEARTBEAT_MS }), true);
});

test("a meaningful move can call after the minimum gap", () => {
  const moved: TapeSignature = { ...quiet, regime: "trend", momentumBps: 2.4, imbalance: 0.4 };
  assert.equal(due({ lastCallAt: 10_000 - 400, next: moved }), false);
  assert.equal(due({ lastCallAt: 10_000 - LIVE_MIN_GAP_MS, next: moved }), true);
});

test("rate-limit backoff blocks the heartbeat", () => {
  assert.equal(due({ lastCallAt: 0, notBefore: 10_001 }), false);
  assert.equal(due({ lastCallAt: 0, notBefore: 10_000 }), true);
});
