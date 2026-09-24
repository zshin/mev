import assert from "node:assert/strict";
import test from "node:test";

import { loadLaws, parseLaws } from "./loadLaws";

test("LAWS.bend caps are the numbers the book will enforce", async () => {
  const laws = await loadLaws();
  assert.match(laws.source, /law NeverPlaceRealOrders/);
  assert.match(laws.source, /law EscalateIsStubbed/);
  assert.match(laws.source, /law PositionCaps/);
  assert.match(laws.source, /law JevGatesRisk/);
  assert.equal(laws.caps.startingCashUsd, 10_000);
  assert.equal(laws.caps.maxTradeNotionalUsd, 200);
  assert.equal(laws.caps.maxSymbolNotionalUsd, 1_500);
  assert.equal(laws.caps.maxGrossNotionalUsd, 3_000);
});

test("missing numbers fall back without throwing", () => {
  const laws = parseLaws("law PositionCaps {\n}\n");
  assert.equal(laws.caps.maxTradeNotionalUsd, 200);
});
