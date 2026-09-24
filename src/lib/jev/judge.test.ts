import assert from "node:assert/strict";
import test from "node:test";

import { judgeTick, type JudgeInput } from "./judge";

function input(overrides: Partial<JudgeInput>): JudgeInput {
  return {
    sampleCount: 20,
    momentumBps: 0,
    imbalance: 0,
    volatilityBps: 4,
    lastMoveBps: 0.2,
    positionNotionalUsd: 0,
    cashUsd: 10_000,
    msSinceLastAct: Number.POSITIVE_INFINITY,
    caps: { maxTradeNotionalUsd: 100, maxSymbolNotionalUsd: 1_500 },
    ...overrides,
  };
}

test("warmup waits", () => {
  const judgment = judgeTick(input({ sampleCount: 3 }));
  assert.equal(judgment.action, "wait");
  assert.match(judgment.reason, /Warmup/);
});

test("aligned buy momentum acts", () => {
  const judgment = judgeTick(input({ momentumBps: 4.2, imbalance: 0.4, volatilityBps: 6 }));
  assert.equal(judgment.action, "act_buy");
  assert.ok(judgment.probability >= 0.78);
});

test("aligned sell momentum acts", () => {
  const judgment = judgeTick(input({ momentumBps: -3.4, imbalance: -0.3, volatilityBps: 5 }));
  assert.equal(judgment.action, "act_sell");
});

test("quiet tape waits", () => {
  const judgment = judgeTick(input({ momentumBps: 0.2, imbalance: 0.02, volatilityBps: 3 }));
  assert.equal(judgment.action, "wait");
});

test("a shock print escalates as a stub reason", () => {
  const judgment = judgeTick(input({ lastMoveBps: 9.5, momentumBps: 9.5, imbalance: 0.8 }));
  assert.equal(judgment.action, "escalate");
  assert.match(judgment.reason, /escalate stub/);
});

test("momentum fighting the tape escalates", () => {
  const judgment = judgeTick(
    input({ momentumBps: 6, imbalance: -0.55, volatilityBps: 8, lastMoveBps: 1 }),
  );
  assert.equal(judgment.action, "escalate");
});

test("act cooldown holds the signal as a wait", () => {
  const judgment = judgeTick(
    input({ momentumBps: 4, imbalance: 0.4, msSinceLastAct: 400 }),
  );
  assert.equal(judgment.action, "wait");
  assert.match(judgment.reason, /held/);
});

test("a full long cap blocks another buy", () => {
  const judgment = judgeTick(
    input({ momentumBps: 4, imbalance: 0.4, positionNotionalUsd: 1_500 }),
  );
  assert.equal(judgment.action, "wait");
  assert.match(judgment.reason, /cap/);
});
