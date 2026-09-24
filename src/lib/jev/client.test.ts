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
