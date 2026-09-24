import assert from "node:assert/strict";
import test from "node:test";

import { applyOrder, createBook, equity, unrealizedPnl, type PaperCaps } from "./book";

const caps: PaperCaps = {
  startingCashUsd: 10_000,
  maxTradeNotionalUsd: 100,
  maxSymbolNotionalUsd: 1_500,
  maxGrossNotionalUsd: 3_000,
};

test("buy then mark-up moves equity and unrealized together", () => {
  const opened = applyOrder(
    createBook(10_000),
    { type: "buy", symbol: "BTCUSDT", notionalUsd: 100, price: 100, time: 1 },
    caps,
    { type: "open" },
    {},
  );
  assert.equal(opened.type, "filled");
  if (opened.type !== "filled") return;
  assert.equal(opened.book.cashUsd, 9_900);
  assert.equal(opened.book.positions.BTCUSDT.qty, 1);
  const marks = { BTCUSDT: 110 };
  assert.equal(unrealizedPnl(opened.book, marks), 10);
  assert.equal(equity(opened.book, marks), 10_010);
  assert.equal(equity(opened.book, marks) - opened.book.startingCashUsd, opened.book.realizedPnlUsd + unrealizedPnl(opened.book, marks));
});

test("selling a long realizes the closed slice", () => {
  const opened = applyOrder(
    createBook(10_000),
    { type: "buy", symbol: "ETHUSDT", notionalUsd: 100, price: 100, time: 1 },
    caps,
    { type: "open" },
    {},
  );
  assert.equal(opened.type, "filled");
  if (opened.type !== "filled") return;
  const closed = applyOrder(
    opened.book,
    { type: "sell", symbol: "ETHUSDT", notionalUsd: 100, price: 110, time: 2 },
    caps,
    { type: "open" },
    { ETHUSDT: 110 },
  );
  assert.equal(closed.type, "filled");
  if (closed.type !== "filled") return;
  const closedQty = 100 / 110;
  assert.ok(Math.abs(closed.book.positions.ETHUSDT.qty - (1 - closedQty)) < 1e-9);
  assert.ok(Math.abs(closed.book.realizedPnlUsd - closedQty * 10) < 1e-6);
  assert.ok(Math.abs(equity(closed.book, { ETHUSDT: 110 }) - 10_010) < 1e-6);
});

test("a short gains when price falls", () => {
  const opened = applyOrder(
    createBook(10_000),
    { type: "sell", symbol: "SOLUSDT", notionalUsd: 100, price: 50, time: 1 },
    caps,
    { type: "open" },
    {},
  );
  assert.equal(opened.type, "filled");
  if (opened.type !== "filled") return;
  assert.equal(opened.book.positions.SOLUSDT.qty, -2);
  assert.equal(unrealizedPnl(opened.book, { SOLUSDT: 40 }), 20);
  assert.equal(equity(opened.book, { SOLUSDT: 40 }), 10_020);
});

test("Jev frozen gate rejects before any fill", () => {
  const result = applyOrder(
    createBook(10_000),
    { type: "buy", symbol: "BTCUSDT", notionalUsd: 100, price: 100, time: 1 },
    caps,
    { type: "frozen", reason: "Jev is off" },
    {},
  );
  assert.equal(result.type, "rejected");
  if (result.type !== "rejected") return;
  assert.equal(result.reason, "Jev is off");
  assert.equal(result.book.tradeCount, 0);
});

test("symbol notional cap shrinks then blocks", () => {
  const tight: PaperCaps = { ...caps, maxSymbolNotionalUsd: 150 };
  const first = applyOrder(
    createBook(10_000),
    { type: "buy", symbol: "BTCUSDT", notionalUsd: 100, price: 100, time: 1 },
    tight,
    { type: "open" },
    {},
  );
  assert.equal(first.type, "filled");
  if (first.type !== "filled") return;
  const second = applyOrder(
    first.book,
    { type: "buy", symbol: "BTCUSDT", notionalUsd: 100, price: 100, time: 2 },
    tight,
    { type: "open" },
    { BTCUSDT: 100 },
  );
  assert.equal(second.type, "filled");
  if (second.type !== "filled") return;
  assert.ok(Math.abs(second.fill.notionalUsd - 50) < 1e-6);
  const third = applyOrder(
    second.book,
    { type: "buy", symbol: "BTCUSDT", notionalUsd: 100, price: 100, time: 3 },
    tight,
    { type: "open" },
    { BTCUSDT: 100 },
  );
  assert.equal(third.type, "rejected");
  if (third.type !== "rejected") return;
  assert.equal(third.reason, "symbol notional cap");
});
