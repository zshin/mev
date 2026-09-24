import assert from "node:assert/strict";
import test from "node:test";

import { requestLiveChoice } from "@/lib/jev/client";
import type { DeskState } from "@/lib/jev/contract";

const state: DeskState = {
  symbol: "BTCUSDT",
  lastPrice: 100,
  momentumBps: 1,
  imbalance: 0.2,
  volatilityBps: 1,
  shockBps: 0.1,
  regime: "chop",
  inventory: 0,
  cooldownMs: 60_000,
  cashRoomUsd: 10_000,
  capsRemaining: { symbolLongUsd: 1_500, symbolShortUsd: 1_500, grossUsd: 3_000, maxTradeUsd: 200 },
};

test("the browser client accepts a host result and rejects a foreign body", async () => {
  const ok = await requestLiveChoice(state, new AbortController().signal, async () => {
    return new Response(
      JSON.stringify({
        type: "closed",
        reason: "missing-key",
        latencyMs: 0,
        retryAfterMs: null,
      }),
      { status: 200 },
    );
  });
  assert.equal(ok.type, "closed");
  if (ok.type === "closed") assert.equal(ok.reason, "missing-key");

  const bad = await requestLiveChoice(state, new AbortController().signal, async () => {
    return new Response(JSON.stringify({ apiKey: "nope", type: "choice" }), { status: 200 });
  });
  assert.equal(bad.type, "closed");
  if (bad.type === "closed") assert.equal(bad.reason, "malformed");
  assert.equal(JSON.stringify(bad).includes("nope"), false);
});

test("the browser client rejects a Choice carried by an HTTP error", async () => {
  const result = await requestLiveChoice(state, new AbortController().signal, async () => {
    return new Response(
      JSON.stringify({
        type: "choice",
        model: "jev-1.13.0",
        latencyMs: 20,
        action: "act_buy",
        probability: 0.95,
        confidence: 0.95,
        optionScores: { act_buy: 0.95, act_sell: 0.01, wait: 0.03, escalate: 0.01 },
      }),
      { status: 503 },
    );
  });
  assert.equal(result.type, "closed");
  if (result.type === "closed") assert.equal(result.reason, "unavailable");
});
