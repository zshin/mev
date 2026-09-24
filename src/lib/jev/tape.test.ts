import assert from "node:assert/strict";
import test from "node:test";

import { readTape, type TapePrint } from "./tape";

function print(time: number, price: number, taker: TapePrint["taker"] = "buy", qty = 1): TapePrint {
  return { time, price, qty, taker };
}

test("an empty tape does not invent a snapshot", () => {
  assert.equal(readTape([]), null);
});

test("momentum, taker imbalance, and halves come off the window", () => {
  const snapshot = readTape([
    print(0, 100, "buy", 1),
    print(1_000, 100.05, "buy", 3),
    print(3_500, 100.08, "sell", 1),
    print(7_000, 100.1, "sell", 1),
  ]);
  assert.ok(snapshot);
  if (!snapshot) return;
  assert.equal(snapshot.sampleCount, 4);
  assert.equal(snapshot.spanMs, 7_000);
  assert.ok(Math.abs(snapshot.momentumBps - 10) < 1e-9);
  assert.ok(snapshot.imbalance > 0);
  assert.ok(snapshot.earlyMomentumBps > 0);
  assert.ok(snapshot.lateMomentumBps > 0);
  assert.ok(snapshot.volatilityBps > 0);
});

test("shock uses the trailing burst when the last print is flat", () => {
  const snapshot = readTape([
    print(0, 100),
    print(1_000, 100),
    print(2_000, 100.2),
    print(2_500, 100.2),
  ]);
  assert.ok(snapshot);
  if (!snapshot) return;
  assert.equal(snapshot.shockSource, "burst");
  assert.ok(snapshot.shockBps > 10);
});

test("shock stays on the last print when that print is the sharp move", () => {
  const snapshot = readTape([
    print(0, 100),
    print(1_000, 100.02),
    print(2_000, 100.02),
    print(2_050, 100.08),
  ]);
  assert.ok(snapshot);
  if (!snapshot) return;
  assert.equal(snapshot.shockSource, "print");
  assert.ok(snapshot.shockBps > 5);
});
