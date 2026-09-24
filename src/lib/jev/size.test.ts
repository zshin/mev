import assert from "node:assert/strict";
import test from "node:test";

import { createBook, type PaperCaps } from "@/lib/paper/book";
import { confidenceBucket, inventoryLean, planSize, type SizePlan } from "@/lib/jev/size";

const caps: PaperCaps = {
  startingCashUsd: 10_000,
  maxTradeNotionalUsd: 200,
  maxSymbolNotionalUsd: 1_500,
  maxGrossNotionalUsd: 3_000,
};

function act(overrides: Partial<Parameters<typeof planSize>[0]> = {}): SizePlan {
  return planSize({
    origin: "live",
    choice: "act_buy",
    probability: 0.95,
    book: createBook(10_000),
    symbol: "BTCUSDT",
    price: 100,
    caps,
    marks: { BTCUSDT: 100 },
    msSinceLastAct: Number.POSITIVE_INFINITY,
    cooldownMs: 2_500,
    ...overrides,
  });
}

function orderNotional(plan: SizePlan): number {
  assert.equal(plan.type, "order");
  if (plan.type !== "order") return 0;
  return plan.notionalUsd;
}

test("confidence buckets use the locked cuts", () => {
  assert.equal(confidenceBucket(0.599), null);
  assert.equal(confidenceBucket(0.6), 50);
  assert.equal(confidenceBucket(0.74), 50);
  assert.equal(confidenceBucket(0.75), 100);
  assert.equal(confidenceBucket(0.89), 100);
  assert.equal(confidenceBucket(0.9), 200);
  assert.equal(confidenceBucket(1), 200);
});

test("a soft live act does not size", () => {
  const plan = act({ probability: 0.59 });
  assert.equal(plan.type, "blocked");
  if (plan.type !== "blocked") return;
  assert.equal(plan.reason, "too-soft");
  assert.equal(plan.line, "p=0.59 · too soft");
});

test("live buckets quote 50, 100, and 200", () => {
  assert.equal(orderNotional(act({ probability: 0.6 })), 50);
  assert.equal(orderNotional(act({ probability: 0.74 })), 50);
  assert.equal(orderNotional(act({ probability: 0.75 })), 100);
  assert.equal(orderNotional(act({ probability: 0.89 })), 100);
  assert.equal(orderNotional(act({ probability: 0.9 })), 200);
  const sized = act({ probability: 0.82 });
  assert.equal(sized.type, "order");
  if (sized.type !== "order") return;
  assert.equal(sized.line, "$100 · p=0.82 · $100 bucket");
});

test("inventory lean applies only when adding to the same side", () => {
  assert.equal(inventoryLean(0.5, "act_buy"), 0.75);
  assert.equal(inventoryLean(-0.5, "act_sell"), 0.75);
  assert.equal(inventoryLean(0.5, "act_sell"), 1);
  assert.equal(inventoryLean(-0.5, "act_buy"), 1);
  assert.equal(inventoryLean(0, "act_buy"), 1);
  assert.equal(inventoryLean(1.4, "act_buy"), 0.5);
  assert.equal(inventoryLean(Number.NaN, "act_buy"), 1);

  const book = createBook(10_000);
  book.positions.BTCUSDT = { qty: 7.5, avgPrice: 100 };
  const adding = act({ book, probability: 0.95 });
  assert.equal(adding.type, "order");
  if (adding.type !== "order") return;
  assert.equal(adding.notionalUsd, 150);
  assert.match(adding.line, /\$150 · p=0\.95 · \$200 bucket · lean ×0\.75/);

  const reducing = act({ book, choice: "act_sell", probability: 0.95 });
  assert.equal(orderNotional(reducing), 200);
  if (reducing.type === "order") assert.equal(reducing.line.includes("lean"), false);
});

test("symbol, gross, cash, and max-trade clamps explain the bind", () => {
  const tightSymbol = act({
    caps: { ...caps, maxSymbolNotionalUsd: 80 },
    marks: { BTCUSDT: 100 },
  });
  assert.equal(orderNotional(tightSymbol), 80);
  if (tightSymbol.type === "order") assert.match(tightSymbol.line, /symbol room/);

  const book = createBook(10_000);
  book.positions.ETHUSDT = { qty: 29.5, avgPrice: 100 };
  const tightGross = act({
    book,
    marks: { BTCUSDT: 100, ETHUSDT: 100 },
  });
  assert.equal(orderNotional(tightGross), 50);
  if (tightGross.type === "order") assert.match(tightGross.line, /gross room/);

  const poor = createBook(40);
  const cashBound = act({ book: poor, probability: 0.62 });
  assert.equal(orderNotional(cashBound), 40);
  if (cashBound.type === "order") assert.equal(cashBound.line, "$40 · p=0.62 · $50 bucket · cash");

  const broke = act({ book: createBook(3), probability: 0.62 });
  assert.equal(broke.type, "blocked");
  if (broke.type === "blocked") assert.match(broke.line, /cash/);

  const tradeCap = act({ caps: { ...caps, maxTradeNotionalUsd: 100 } });
  assert.equal(orderNotional(tradeCap), 100);
  if (tradeCap.type === "order") assert.match(tradeCap.line, /max trade/);
});

test("cooldown blocks a sized act and escalate never sizes", () => {
  const cooled = act({ msSinceLastAct: 1_000, probability: 0.82 });
  assert.equal(cooled.type, "blocked");
  if (cooled.type !== "blocked") return;
  assert.equal(cooled.reason, "cooldown");
  assert.match(cooled.line, /p=0\.82 · \$100 bucket · cooldown 1\.5s/);

  assert.equal(act({ choice: "escalate", probability: 0.99 }).type, "skip");
  assert.equal(act({ choice: "wait", probability: 0.99 }).type, "skip");
});

test("the local surface keeps a flat clip and ignores the live ladder", () => {
  const plan = act({ origin: "local", probability: 0.1 });
  assert.equal(plan.type, "order");
  if (plan.type !== "order") return;
  assert.equal(plan.notionalUsd, 200);
  assert.equal(plan.line, "$200 · local surface");
});
