import assert from "node:assert/strict";
import test from "node:test";

import { parseMarketPayload, parseRestKlines } from "./binance";

test("trade payload becomes a taker-aware market event", () => {
  const event = parseMarketPayload({
    e: "trade",
    s: "BTCUSDT",
    p: "84213.11",
    q: "0.010",
    T: 1_700_000_000_000,
    m: false,
  });
  assert.equal(event?.type, "trade");
  if (event?.type !== "trade") return;
  assert.equal(event.taker, "buy");
  assert.equal(event.price, 84213.11);
});

test("maker-buyer trade is a sell taker", () => {
  const event = parseMarketPayload({
    e: "trade",
    s: "ETHUSDT",
    p: "2500",
    q: "1",
    T: 10,
    m: true,
  });
  assert.equal(event?.type, "trade");
  if (event?.type !== "trade") return;
  assert.equal(event.taker, "sell");
});

test("one-second kline becomes a candle event", () => {
  const event = parseMarketPayload({
    e: "kline",
    s: "SOLUSDT",
    k: {
      t: 1_700_000_000_000,
      i: "1s",
      o: "100",
      h: "110",
      l: "90",
      c: "105",
      x: false,
    },
  });
  assert.equal(event?.type, "kline");
  if (event?.type !== "kline") return;
  assert.equal(event.time, 1_700_000_000);
  assert.equal(event.close, 105);
  assert.equal(event.closed, false);
});

test("acks and foreign symbols are ignored", () => {
  assert.equal(parseMarketPayload({ result: null, id: 1 }), null);
  assert.equal(
    parseMarketPayload({ e: "trade", s: "DOGEUSDT", p: "1", q: "1", T: 1, m: false }),
    null,
  );
});

test("rest klines keep open time in seconds", () => {
  const candles = parseRestKlines([
    [1_700_000_000_000, "10", "12", "9", "11", "1"],
    [1_700_000_001_000, "11", "13", "10", "12", "2"],
  ]);
  assert.equal(candles.length, 2);
  assert.equal(candles[0]?.time, 1_700_000_000);
  assert.equal(candles[1]?.close, 12);
});
