import assert from "node:assert/strict";
import test from "node:test";

import { classifyRegime, opensRisk, THRESHOLDS } from "./surface";

test("regime is trend only when both halves persist inside a clean range", () => {
  assert.equal(classifyRegime(0.7, 0.7, 3.9), "trend");
  assert.equal(classifyRegime(-1.2, -0.8, 2), "trend");
  assert.equal(classifyRegime(0.7, 0.69, 2), "chop");
  assert.equal(classifyRegime(1.4, -1.1, 2), "chop");
  assert.equal(classifyRegime(1.2, 1.2, THRESHOLDS.trendMaxVolBps), "chop");
  assert.equal(classifyRegime(0, 2, 1), "chop");
});

test("only acts open paper risk", () => {
  assert.equal(opensRisk("act_buy"), true);
  assert.equal(opensRisk("act_sell"), true);
  assert.equal(opensRisk("wait"), false);
  assert.equal(opensRisk("escalate"), false);
});

test("escalate thresholds sit inside a lively tape and above a quiet print", () => {
  assert.ok(THRESHOLDS.shockBps < 3);
  assert.ok(THRESHOLDS.shockBps > 1);
  assert.ok(THRESHOLDS.wideVolBps > THRESHOLDS.trendMaxVolBps);
  assert.ok(THRESHOLDS.whipsawHalfBps >= THRESHOLDS.trendHalfBps);
  assert.equal(THRESHOLDS.actCooldownMs, 2_500);
});
