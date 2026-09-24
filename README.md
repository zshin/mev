# Jev Paper Desk

A fullscreen paper-trading wall. It reads the public Binance tape, asks **live Jev** for one typed Choice, and — only while Jev is armed — sizes and fills a paper book. Nothing here can place a real order.

The path to say out loud is **tape → features → live Jev Choice → p → host size → LAWS gate → paper fill**. Read [STRATEGY.md](STRATEGY.md) before a demo.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The desk is built for a 1440px desktop window.

Put the TypeSafe key in `.env.local` or the process environment. The name is `TYPESAFE_API_KEY`. Do not commit it. `.env.example` has the name only.

```bash
npm test
npm run typecheck
npm run lint
```

`GET /api/jev/health` returns `{ configured, model }`. `configured` is true when the key is non-empty. The response never includes the key.

## What you are looking at

Jev starts **off**. The tape still moves. Turning it on allows judgments. With a key present, the desk defaults to **Live Jev**. Without a key, it stays on the **Local surface** and labels that mode offline fallback. The feed header toggles Live Jev / Local surface either way.

Live mode posts one Choice (`act_buy`, `act_sell`, `wait`, `escalate`) to TypeSafe `jev-latest`. The host maps the selected option's probability to $50 / $100 / $200, leans against adding to a side you already hold, then clamps to the caps. Below 0.60 there is no fill. Escalate is a stub.

The bottom of the wall is one chronological feed, newest first. Filters are All, Act, Wait, Escalate. Acts are always kept. A repeated wait is kept again after 4s, a repeated escalate after 5s. An act row shows `$size · p=… · bucket/lean/cap` and the judgment id. A paper fill uses that same id.

The readout beside the feed shows Live vs Local, the model id that answered, latency, the four probabilities, the regime, and a size preview. Local feature numbers can refresh faster than the hosted call. Calls go out on a meaningful tape change or about every 2.5 seconds, not on every tick.

If the key is missing, the call times out, or TypeSafe returns 401, 429, 5xx, or a body we will not trust, that cycle is wait and the wall says why. The Binance stream keeps running. The desk does not quietly trade the local scorer in live mode.

## What is real, and what is paper

| | Real | Paper |
| --- | --- | --- |
| Prices | Binance public trades and 1-second klines | — |
| Live Jev | A hosted Choice. The key stays on this server | The order is still paper, at the last trade |
| Local surface | — | Offline fallback in this process. Not a hosted call |
| Orders | Never sent. No exchange key, no account, no wallet | Buy increases quantity, sell decreases it, inside the caps |
| Size | Jev does not pick dollars | Ladder on `p`, then lean and caps. Local acts use a flat $200 clip |
| P&L | Marked from the live price | Cash, position, realized, unrealized |
| Escalate | — | A row in the feed. No webhook, no page |
| Chart | Binance prices via TradingView Lightweight Charts | The library logo is hidden. The chart header links the credit. This is not a TradingView terminal |

## Controls

1. **BTC / ETH / SOL** — switches the Binance symbol and reconnects the stream. The paper book is kept. Marks for the coin you left update when you come back.
2. **JEV ON / OFF** — master gate for judgments and new fills.
3. **Live Jev / Local surface** — hosted Choice, or the offline fallback. Live is the default when a key is configured.
4. **Decisions** — one feed. Filters are All, Act, Wait, Escalate.
5. **Readout** — regime, model, latency, four probabilities, size preview.
6. **Equity curve** — appears after the first paper fill and keeps updating.
7. **Paper book** — recent fills list the judgment id that caused them.

## Market endpoints

The desk prefers the public spot socket:

- `wss://stream.binance.com:9443/ws` with `trade` and `kline_1s`
- Candle bootstrap goes through `/api/klines` on this server, which calls Binance REST. The browser does not call Binance REST itself.

If the preferred host does not open, the desk falls back to Binance's public market-data endpoint. Same streams, still no orders:

- `wss://data-stream.binance.vision/ws`
- `https://data-api.binance.vision`

The live host is shown under the price.

## Live Jev

`POST /api/jev` accepts the compact desk state and calls `POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer $TYPESAFE_API_KEY`. The model alias on the request is `jev-latest`. The readout shows the version id TypeSafe returns. Errors shown on the wall are fixed phrases. They do not include the key or the response body.

## LAWS.bend

`LAWS.bend` at the repo root is the desk constitution and is rendered in the laws panel. `PositionCaps` numbers are parsed by `src/lib/laws/loadLaws.ts` and enforced by the paper book. The other laws are hard gates in code: there is no order client, escalate never leaves the process, and Jev must be on before a fill can open risk. Editing a `forbid` line does not change runtime. There is no law interpreter.

Caps today: cash $10,000, max trade $200, symbol $1,500, gross $3,000. They bind **new orders**, not mark-to-market. A rally can print gross above the cap after a fill.

## Layout

- `src/lib/market/binance.ts` — REST bootstrap and WebSocket
- `src/lib/jev/tape.ts` — window features, including shock
- `src/lib/jev/surface.ts` — offline fallback: regime, scores, softmax, gates
- `src/lib/jev/askJev.ts` — server-side TypeSafe Choice client
- `src/lib/jev/size.ts` — probability buckets, inventory lean, cap clamps
- `src/lib/jev/decide.ts` — host policy: size, or wait, or stub
- `src/lib/jev/cadence.ts` — when a live call is due
- `src/app/api/jev/route.ts` — holds the key
- `src/app/api/jev/health/route.ts` — configured or not, never the key
- `src/lib/paper/book.ts` — paper portfolio; fills carry `judgmentId`
- `src/lib/laws/loadLaws.ts` — reads `LAWS.bend`
- `src/lib/store.ts` — one desk store
- `src/components/DecisionFeed.tsx` — sequential feed
- `src/components/SurfaceReadout.tsx` — live or local readout
- `STRATEGY.md` — the one-pager for the demo
