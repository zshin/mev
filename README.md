# Jev Paper Desk

A fullscreen paper-trading wall. It reads the public Binance tape, scores a local **Tape Alignment Surface** on each cycle, and — only while Jev is armed — fills a paper book. Nothing here can place a real order.

The surface is a typed stand-in shaped like Jev (four options, a probability, then a gate). It is not a hosted Jev call. Read [STRATEGY.md](STRATEGY.md) before a demo.

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

## What you are looking at

Each cycle the desk scores `act_buy`, `act_sell`, `wait`, and `escalate` from the live window and the paper book. Softmax turns those scores into a probability. Hard gates from Jev, cooldown, and `LAWS.bend` win over the scores. The path to say out loud is **inputs → Surface scores → probability → gated action**.

The bottom of the wall is one chronological feed, newest first. It keeps every act, and it keeps waits and escalates when the action changes or the repeat window elapses (4s wait, 5s escalate). The **Surface** stack beside the feed is the current cycle: regime, and the four probabilities as bars.

A card shows time, symbol, action, probability, the short reasons (`drivers`), and a fill mark when there is one (`$100 · d3`, or `Blocked`). The second line is the features: momentum, taker imbalance, vol, shock, inventory, cooldown, and the runner-up option. Escalate is a stub. It is on the same tape. It never fills.

Jev starts **off**. The tape still moves. Turning it on starts judgments and allows new paper risk. Turning it off freezes new judgments and fills. An open paper position keeps marking to market.

Calm BTC often waits. A single BTC print is usually a fraction of a basis point, so escalate shows up on a 1s burst, a reversal, a wide range, or momentum fighting the taker — more often on SOL than on a quiet BTC book. The thresholds are in [STRATEGY.md](STRATEGY.md).

## What is real, and what is paper

| | Real | Paper |
| --- | --- | --- |
| Prices | Binance public trades and 1-second klines | — |
| Judge | — | Local Tape Alignment Surface in this process. Not a hosted model |
| Orders | Never sent. No API key, no account, no wallet | Marketable buy/sell at the last trade, tied to the judgment id |
| Size | — | `$100` notional, capped by `LAWS.bend` |
| P&L | Marked from the live price | Cash, position, realized, unrealized |
| Escalate | — | A row in the feed. No model call, no page, no webhook |
| Chart | Binance prices via TradingView Lightweight Charts | The library logo is hidden. The chart header links the credit. This is not a TradingView terminal |

## Controls

1. **BTC / ETH / SOL** — switches the Binance symbol and reconnects the stream. The paper book is kept. Marks for the coin you left update when you come back.
2. **JEV ON / OFF** — master gate for judgments and new fills.
3. **Decisions** — one feed. Filters are All, Act, Wait, Escalate. The default is the full tape.
4. **Surface** — current regime and the four option probabilities.
5. **Equity curve** — appears after the first paper fill and keeps updating.
6. **Paper book** — recent fills list the judgment id that caused them.

## Market endpoints

The desk prefers the public spot socket:

- `wss://stream.binance.com:9443/ws` with `trade` and `kline_1s`
- Candle bootstrap goes through `/api/klines` on this server, which calls Binance REST. The browser does not call Binance REST itself.

If the preferred host does not open, the desk falls back to Binance's public market-data endpoint. Same streams, still no orders:

- `wss://data-stream.binance.vision/ws`
- `https://data-api.binance.vision`

The live host is shown under the price.

## LAWS.bend

`LAWS.bend` at the repo root is the desk constitution and is rendered in the laws panel. `PositionCaps` numbers are parsed by `src/lib/laws/loadLaws.ts` and enforced by the paper book and by the surface gate. The other laws are hard gates in code: there is no order client, escalate never leaves the process, and Jev must be on before `applyOrder` will open risk. Editing a `forbid` line does not change runtime. There is no law interpreter.

Caps bind **new orders**, not mark-to-market. A rally can print gross above the cap after a fill.

## Layout

- `src/lib/market/binance.ts` — REST bootstrap and WebSocket
- `src/lib/jev/tape.ts` — window features, including shock
- `src/lib/jev/surface.ts` — regime, scores, softmax, gates
- `src/lib/jev/judge.ts` — the `judgeTick` entry the store calls
- `src/lib/paper/book.ts` — paper portfolio; fills carry `judgmentId`
- `src/lib/laws/loadLaws.ts` — reads `LAWS.bend`
- `src/lib/store.ts` — one desk store
- `src/components/DecisionFeed.tsx` — sequential feed
- `src/components/SurfaceReadout.tsx` — live four-way scores
- `STRATEGY.md` — the one-pager for the demo
