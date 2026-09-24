import assert from "node:assert/strict";
import test from "node:test";

import { judgeTick, opensRisk, type JudgeAction, type JudgeInput, type Judgment } from "./judge";

const caps = { maxTradeNotionalUsd: 100, maxSymbolNotionalUsd: 1_500, maxGrossNotionalUsd: 3_000 };

function input(overrides: Partial<JudgeInput> = {}): JudgeInput {
  return {
    sampleCount: 24,
    spanMs: 6_000,
    momentumBps: 0.2,
    imbalance: 0.02,
    volatilityBps: 1.1,
    shockBps: 0.1,
    shockSource: "print",
    earlyMomentumBps: 0.1,
    lateMomentumBps: 0.05,
    positionNotionalUsd: 0,
    grossNotionalUsd: 0,
    cashUsd: 10_000,
    msSinceLastAct: Number.POSITIVE_INFINITY,
    jevEnabled: true,
    caps,
    ...overrides,
  };
}

const trendBuy = {
  momentumBps: 3.2,
  imbalance: 0.55,
  volatilityBps: 2.2,
  shockBps: 0.2,
  earlyMomentumBps: 1.4,
  lateMomentumBps: 1.5,
} satisfies Partial<JudgeInput>;

function assertSurface(judgment: Judgment) {
  let sum = 0;
  const actions: JudgeAction[] = ["act_buy", "act_sell", "wait", "escalate"];
  for (const action of actions) {
    const score = judgment.optionScores[action];
    assert.ok(score >= 0 && score <= 1, `${action} ${score}`);
    assert.ok(score <= judgment.probability + 1e-9);
    sum += score;
  }
  assert.ok(Math.abs(sum - 1) < 1e-9, `scores sum to ${sum}`);
  assert.equal(judgment.probability, judgment.optionScores[judgment.action]);
  assert.ok(judgment.drivers.length >= 2 && judgment.drivers.length <= 4, judgment.drivers.join(" | "));
  assert.equal(judgment.reason, judgment.drivers.join(" · "));
  assert.equal(judgment.features.momentumBps, judgment.features.momentumBps);
}

test("warmup waits and does not open risk", () => {
  const judgment = judgeTick(input({ sampleCount: 4, ...trendBuy }));
  assert.equal(judgment.action, "wait");
  assert.match(judgment.reason, /warmup/);
  assert.equal(opensRisk(judgment.action), false);
  assertSurface(judgment);
});

test("warmup probabilities still pass through hard gates", () => {
  const judgment = judgeTick(input({ sampleCount: 4, jevEnabled: false, ...trendBuy }));
  assert.equal(judgment.action, "wait");
  assert.ok(judgment.optionScores.act_buy < 0.001);
  assert.ok(judgment.optionScores.act_sell < 0.001);
  assertSurface(judgment);
});

test("a short window waits even when the later tape would trend", () => {
  const judgment = judgeTick(input({ spanMs: 800, ...trendBuy }));
  assert.equal(judgment.action, "wait");
  assert.match(judgment.reason, /window still opening/);
  assertSurface(judgment);
});

test("trend plus aligned taker buys", () => {
  const judgment = judgeTick(input(trendBuy));
  assert.equal(judgment.regime, "trend");
  assert.equal(judgment.action, "act_buy");
  assert.match(judgment.reason, /trend \+ aligned taker/);
  assert.match(judgment.reason, /buy/);
  assert.ok(judgment.probability >= 0.5);
  assertSurface(judgment);
});

test("trend plus aligned taker sells", () => {
  const judgment = judgeTick(
    input({
      momentumBps: -3.1,
      imbalance: -0.48,
      volatilityBps: 2.1,
      shockBps: -0.15,
      earlyMomentumBps: -1.3,
      lateMomentumBps: -1.4,
    }),
  );
  assert.equal(judgment.regime, "trend");
  assert.equal(judgment.action, "act_sell");
  assertSurface(judgment);
});

test("chop does not chase a one-sided push", () => {
  const judgment = judgeTick(
    input({
      momentumBps: 2,
      imbalance: 0.6,
      volatilityBps: 2.2,
      shockBps: 0.15,
      earlyMomentumBps: 1.8,
      lateMomentumBps: 0.15,
    }),
  );
  assert.equal(judgment.regime, "chop");
  assert.equal(judgment.action, "wait");
  assert.match(judgment.reason, /chop, do not chase/);
  assertSurface(judgment);
});

test("quiet tape waits inside the noise", () => {
  const judgment = judgeTick(input());
  assert.equal(judgment.action, "wait");
  assert.equal(judgment.regime, "chop");
  assert.match(judgment.reason, /inside the noise/);
  assertSurface(judgment);
});

test("a sharp burst escalates as a stub and does not open risk", () => {
  const judgment = judgeTick(
    input({
      momentumBps: 0.3,
      imbalance: 0.04,
      volatilityBps: 1.4,
      shockBps: 2.4,
      shockSource: "burst",
      earlyMomentumBps: 0.2,
      lateMomentumBps: 0.1,
    }),
  );
  assert.equal(judgment.action, "escalate");
  assert.match(judgment.reason, /shock \+2\.4 bps/);
  assert.match(judgment.reason, /stub only/);
  assert.equal(opensRisk(judgment.action), false);
  assertSurface(judgment);
});

test("momentum fighting the taker escalates", () => {
  const judgment = judgeTick(
    input({
      momentumBps: 2.4,
      imbalance: -0.5,
      volatilityBps: 2,
      shockBps: 0.2,
      earlyMomentumBps: 1.2,
      lateMomentumBps: 1.1,
    }),
  );
  assert.equal(judgment.action, "escalate");
  assert.match(judgment.reason, /momentum and taker disagree/);
  assertSurface(judgment);
});

test("a reversed window escalates in chop", () => {
  const judgment = judgeTick(
    input({
      momentumBps: 0.2,
      imbalance: 0.04,
      volatilityBps: 2.6,
      shockBps: 0.2,
      earlyMomentumBps: 1.4,
      lateMomentumBps: -1.3,
    }),
  );
  assert.equal(judgment.regime, "chop");
  assert.equal(judgment.action, "escalate");
  assert.match(judgment.reason, /window reversed/);
  assertSurface(judgment);
});

test("a wide chop range escalates", () => {
  const judgment = judgeTick(
    input({
      momentumBps: 0.4,
      imbalance: 0.05,
      volatilityBps: 5.2,
      shockBps: 0.2,
      earlyMomentumBps: 0.3,
      lateMomentumBps: -0.2,
    }),
  );
  assert.equal(judgment.action, "escalate");
  assert.match(judgment.reason, /range 5\.2 bps/);
  assertSurface(judgment);
});

test("cooldown holds a buy and says why", () => {
  const judgment = judgeTick(input({ ...trendBuy, msSinceLastAct: 400 }));
  assert.equal(judgment.action, "wait");
  assert.match(judgment.reason, /cooldown 2\.1s/);
  assert.match(judgment.reason, /surface leaned buy/);
  assert.ok(judgment.optionScores.act_buy < 0.02);
  assert.ok(judgment.optionScores.act_sell < 0.02);
  assertSurface(judgment);
});

test("a shock still escalates during cooldown", () => {
  const judgment = judgeTick(input({ ...trendBuy, shockBps: 3, msSinceLastAct: 200 }));
  assert.equal(judgment.action, "escalate");
  assert.doesNotMatch(judgment.reason, /cooldown/);
  assertSurface(judgment);
});

test("a full long cap blocks another buy", () => {
  const judgment = judgeTick(input({ ...trendBuy, positionNotionalUsd: 1_500 }));
  assert.equal(judgment.action, "wait");
  assert.match(judgment.reason, /symbol cap binds/);
  assert.match(judgment.reason, /surface leaned buy/);
  assertSurface(judgment);
});

test("a full long still allows a sell", () => {
  const judgment = judgeTick(
    input({
      momentumBps: -3.1,
      imbalance: -0.48,
      volatilityBps: 2.1,
      shockBps: -0.1,
      earlyMomentumBps: -1.3,
      lateMomentumBps: -1.4,
      positionNotionalUsd: 1_500,
    }),
  );
  assert.equal(judgment.action, "act_sell");
  assertSurface(judgment);
});

test("covering a full short is not a symbol-cap wait", () => {
  const judgment = judgeTick(input({ ...trendBuy, positionNotionalUsd: -1_500 }));
  assert.equal(judgment.action, "act_buy");
  assertSurface(judgment);
});

test("cash insufficient blocks a buy", () => {
  const judgment = judgeTick(input({ ...trendBuy, cashUsd: 1 }));
  assert.equal(judgment.action, "wait");
  assert.match(judgment.reason, /cash insufficient/);
  assertSurface(judgment);
});

test("gross cap blocks a new buy", () => {
  const judgment = judgeTick(input({ ...trendBuy, grossNotionalUsd: 3_000 }));
  assert.equal(judgment.action, "wait");
  assert.match(judgment.reason, /gross cap binds/);
  assertSurface(judgment);
});

test("Jev off cannot act", () => {
  const judgment = judgeTick(input({ ...trendBuy, jevEnabled: false }));
  assert.equal(judgment.action, "wait");
  assert.match(judgment.reason, /Jev is off/);
  assert.equal(opensRisk(judgment.action), false);
  assertSurface(judgment);
});

test("a larger long inventory lowers the buy probability", () => {
  const flat = judgeTick(input(trendBuy));
  const long = judgeTick(input({ ...trendBuy, positionNotionalUsd: 1_000 }));
  assert.equal(flat.action, "act_buy");
  assert.ok(long.optionScores.act_buy < flat.optionScores.act_buy);
  assert.ok(long.features.inventory > flat.features.inventory);
});

test("features carry the tape the card will show", () => {
  const judgment = judgeTick(input({ ...trendBuy, msSinceLastAct: 8_000 }));
  assert.equal(judgment.features.momentumBps, 3.2);
  assert.equal(judgment.features.imbalance, 0.55);
  assert.equal(judgment.features.volatilityBps, 2.2);
  assert.equal(judgment.features.shockBps, 0.2);
  assert.equal(judgment.features.cooldown, 8_000);
  assert.equal(judgment.features.inventory, 0);
});
