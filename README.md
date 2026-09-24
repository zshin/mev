# Jev Paper Desk

A fullscreen paper-trading wall. It reads the public Binance tape, runs a typed Jev-style judgment on each throttled tick, and — only while Jev is armed — fills a paper book. Nothing here can place a real order.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The desk is built for a 1440px desktop window.

```bash
npm test
npm run typecheck
npm run lint
```

## What is real, and what is paper

| | Real | Paper |
| --- | --- | --- |
| Prices | Binance public trades and 1-second klines | — |
| Orders | Never sent. No API key, no account, no wallet | Marketable buy/sell at the last trade |
| Size | — | `$100` notional, capped by `LAWS.bend` |
| P&L | Marked from the live price | Cash, position, realized, unrealized |
| Escalate | — | A glowing stub on the wall. No model call, no page, no webhook |

Jev starts **off**. The tape still moves. Turning it on starts judgments and allows new paper risk. Turning it off freezes new judgments and fills; an open paper position keeps marking to market.

## Controls

1. **BTC / ETH / SOL** — switches the Binance symbol and reconnects the stream. The paper book is kept.
2. **JEV ON / OFF** — master gate for judgments and new fills.
3. **Equity curve** — appears after the first paper fill and keeps updating.
4. **Escalate lane** — ambiguous or shocky tape prints `Escalate (stub)` and does not trade.

## Market endpoints

The desk prefers the public spot socket:

- `wss://stream.binance.com:9443/ws` with `trade` and `kline_1s`
- REST `https://api.binance.com/api/v3/klines` to bootstrap candles

If that host is blocked, it falls back to Binance's public market-data endpoint, which speaks the same streams and still accepts no orders:

- `wss://data-stream.binance.vision/ws`
- `https://data-api.binance.vision`

The live host is shown under the price.

## LAWS.bend

`LAWS.bend` at the repo root is the desk constitution and is rendered in the laws panel. `PositionCaps` numbers are parsed by `src/lib/laws/loadLaws.ts` and enforced by the paper book. The other laws are hard gates: there is no order client, escalate never leaves the process, and Jev must be on before `applyOrder` will open risk.

## Layout

- `src/lib/market/binance.ts` — REST bootstrap and WebSocket
- `src/lib/paper/book.ts` — paper portfolio
- `src/lib/jev/judge.ts` — `judgeTick`
- `src/lib/laws/loadLaws.ts` — reads `LAWS.bend`
- `src/lib/store.ts` — one desk store
- `src/components/*` — the wall
