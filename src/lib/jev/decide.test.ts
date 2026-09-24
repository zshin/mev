import assert from "node:assert/strict";
import test from "node:test";

import { decidePaper } from "@/lib/jev/decide";
import { choiceJudgment, closedJudgment } from "@/lib/jev/liveJudgment";
import { THRESHOLDS, type SurfaceFeatures } from "@/lib/jev/surface";
import { createBook, type PaperCaps } from "@/lib/paper/book";

const caps: PaperCaps = {
  startingCashUsd: 10_000,
  maxTradeNotionalUsd: 200,
  maxSymbolNotionalUsd: 1_500,
  maxGrossNotionalUsd: 3_000,
};

const features: SurfaceFeatures = {
  momentumBps: 2.4,
  imbalance: 0.4,
  volatilityBps: 1.5,
  shockBps: 0.2,
  inventory: 0,
  cooldown: 60_000,
};

function liveChoice(probability: number, action: "act_buy" | "act_sell" | "wait" | "escalate" = "act_buy") {
  const rest = (1 - probability) / 3;
  const optionScores = { act_buy: rest, act_sell: rest, wait: rest, escalate: rest, [action]: probability };
  return choiceJudgment({
    features,
    regime: "trend",
    choice: {
      type: "choice",
      model: "jev-1.13.0",
      latencyMs: 90,
      action,
      probability: optionScores[action],
      confidence: 0.7,
      optionScores,
    },
  });
}

test("a soft Choice is recorded as wait and does not fill", () => {
  const book = createBook(10_000);
  const judgment = liveChoice(0.55);
  const decided = decidePaper({
    judgment,
    choice: judgment.action,
    choiceProbability: judgment.probability,
    book,
    symbol: "BTCUSDT",
    price: 100,
    time: 1,
    judgmentId: "d1",
    caps,
    marks: { BTCUSDT: 100 },
    gate: { type: "open" },
    msSinceLastAct: Number.POSITIVE_INFINITY,
    cooldownMs: THRESHOLDS.actCooldownMs,
  });
  assert.equal(decided.judgment.action, "wait");
  assert.match(decided.judgment.reason, /too soft/);
  assert.equal(decided.fill.type, "rejected");
  if (decided.fill.type === "rejected") assert.equal(decided.fill.reason, "too soft");
  assert.equal(decided.sizeLine, "p=0.55 · too soft");
  assert.equal(decided.book.cashUsd, 10_000);
  assert.equal(decided.filled, false);
});

test("a confident buy fills at the bucket and keeps the judgment id", () => {
  const judgment = liveChoice(0.91);
  const decided = decidePaper({
    judgment,
    choice: "act_buy",
    choiceProbability: 0.91,
    book: createBook(10_000),
    symbol: "BTCUSDT",
    price: 100,
    time: 5,
    judgmentId: "d9",
    caps,
    marks: { BTCUSDT: 100 },
    gate: { type: "open" },
    msSinceLastAct: Number.POSITIVE_INFINITY,
    cooldownMs: THRESHOLDS.actCooldownMs,
  });
  assert.equal(decided.filled, true);
  assert.equal(decided.fill.type, "filled");
  if (decided.fill.type !== "filled") return;
  assert.equal(decided.fill.notionalUsd, 200);
  assert.equal(decided.fill.judgmentId, "d9");
  assert.equal(decided.book.fills[0]?.judgmentId, "d9");
  assert.match(decided.sizeLine ?? "", /^\$200 · p=0\.91 · \$200 bucket/);
});

test("escalate and a closed call do not fill", () => {
  const escalate = liveChoice(0.7, "escalate");
  const escalated = decidePaper({
    judgment: escalate,
    choice: "escalate",
    choiceProbability: 0.7,
    book: createBook(10_000),
    symbol: "SOLUSDT",
    price: 100,
    time: 1,
    judgmentId: "e1",
    caps,
    marks: {},
    gate: { type: "open" },
    msSinceLastAct: Number.POSITIVE_INFINITY,
    cooldownMs: THRESHOLDS.actCooldownMs,
  });
  assert.equal(escalated.fill.type, "none");
  assert.equal(escalated.book.tradeCount, 0);
  assert.match(escalate.reason, /stub only/);

  const closed = closedJudgment({ reason: "timeout", latencyMs: 4000, features, regime: "chop" });
  assert.equal(closed.action, "wait");
  assert.equal(closed.failure, "Jev timed out");
  assert.match(closed.reason, /fail closed/);
  const decided = decidePaper({
    judgment: closed,
    choice: "wait",
    choiceProbability: 1,
    book: createBook(10_000),
    symbol: "BTCUSDT",
    price: 100,
    time: 1,
    judgmentId: "c1",
    caps,
    marks: {},
    gate: { type: "open" },
    msSinceLastAct: Number.POSITIVE_INFINITY,
    cooldownMs: THRESHOLDS.actCooldownMs,
  });
  assert.equal(decided.filled, false);
  assert.equal(decided.book.tradeCount, 0);
});

test("a frozen gate does not fill a live buy", () => {
  const judgment = liveChoice(0.95);
  const decided = decidePaper({
    judgment,
    choice: "act_buy",
    choiceProbability: 0.95,
    book: createBook(10_000),
    symbol: "BTCUSDT",
    price: 100,
    time: 1,
    judgmentId: "f1",
    caps,
    marks: {},
    gate: { type: "frozen", reason: "Jev is off" },
    msSinceLastAct: Number.POSITIVE_INFINITY,
    cooldownMs: THRESHOLDS.actCooldownMs,
  });
  assert.equal(decided.fill.type, "rejected");
  if (decided.fill.type === "rejected") assert.equal(decided.fill.reason, "Jev is off");
  assert.equal(decided.book.tradeCount, 0);
});
