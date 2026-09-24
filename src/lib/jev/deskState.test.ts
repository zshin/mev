import assert from "node:assert/strict";
import test from "node:test";

import { buildDeskState } from "@/lib/jev/deskState";
import { deskStateSchema } from "@/lib/jev/contract";
import type { SurfaceFeatures } from "@/lib/jev/surface";

const features: SurfaceFeatures = {
  momentumBps: 1.234,
  imbalance: 0.4567,
  volatilityBps: 2.2,
  shockBps: -0.4,
  inventory: 1.4,
  cooldown: Number.POSITIVE_INFINITY,
};

test("desk state is compact, clamped, and schema-valid", () => {
  const state = buildDeskState({
    symbol: "ETHUSDT",
    lastPrice: 2500.129,
    regime: "trend",
    features,
    positionNotionalUsd: 2_100,
    cashUsd: 8_000,
    grossNotionalUsd: 2_100,
    symbolCapUsd: 1_500,
    grossCapUsd: 3_000,
    maxTradeUsd: 200,
  });
  assert.ok(state);
  if (!state) return;
  assert.equal(deskStateSchema.safeParse(state).success, true);
  assert.equal(state.inventory, 1);
  assert.equal(state.cooldownMs, 60_000);
  assert.equal(state.momentumBps, 1.23);
  assert.equal(state.capsRemaining.symbolLongUsd, 0);
  assert.equal(state.capsRemaining.symbolShortUsd, 3_600);
  assert.equal(state.capsRemaining.grossUsd, 900);
  assert.equal(state.lastPrice, 2500.13);
  assert.equal(JSON.stringify(state).length < 500, true);
});

test("a missing price does not produce a state", () => {
  assert.equal(
    buildDeskState({
      symbol: "BTCUSDT",
      lastPrice: 0,
      regime: "chop",
      features,
      positionNotionalUsd: 0,
      cashUsd: 10_000,
      grossNotionalUsd: 0,
      symbolCapUsd: 1_500,
      grossCapUsd: 3_000,
      maxTradeUsd: 200,
    }),
    null,
  );
});
