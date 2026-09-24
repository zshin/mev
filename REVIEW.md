# Jev Paper Desk — adversarial review

Verdict: **ship-with-fixes**.

Do not merge from this review. There is no live-order path, and the happy path is real Binance data. Two feed-failover holes could still blank the tape on stage; they are fixed on this branch. What is left is a show script, not another code pass, unless Zeno wants Escalate to actually print.

## What holds

Paper only. The desk never signs a request, never reads an API key, and never calls an order route. Market IO is public klines plus a public trade/kline socket (`src/lib/market/binance.ts:5`, `src/lib/market/binance.ts:7`). The klines proxy allowlists `BTCUSDT` / `ETHUSDT` / `SOLUSDT` and clamps `limit` to 20–500 (`src/app/api/klines/route.ts:6`). Hosts are constants, not caller input. No SSRF. No `dangerouslySetInnerHTML`. Laws text and error strings are React text nodes.

Jev boots **off** (`src/lib/store.ts:93`). With it off, `maybeJudge` returns before `judgeTick` and before `applyOrder` (`src/lib/store.ts:279`). Trades still update the chart and the headline in `handleEvent` before that return. Turning it on is what starts judgments and paper fills. Escalate never leaves the process: only `act_buy` / `act_sell` reach `applyOrder` (`src/lib/store.ts:303`).

`LAWS.bend` is on the wall. The four position numbers are parsed and passed into the book (`src/lib/laws/loadLaws.ts:22`). A direct run of the book keeps `equity = starting + realized + unrealized` across a few hundred mixed buys and sells. Six $100 BTC shorts at 84,129.92 produce cash $10,600, quantity about −0.007132, gross $600, equity $10,000. The equity sparkline in the attached shot (a hair above $10,000) matches that. If the cash cell in that shot truly reads $10,000, the frame does not match this book; the digit is easy to misread as 0.

Coin-switch fills do not leak across symbols. `stale` drops events when the abort fired, the generation moved, or the active symbol changed (`src/lib/store.ts:509`), and that check runs before `handleEvent`. The generation bump is synchronous inside `startFeed`, before the next socket task can run. Abort closes the live socket: the opener keeps its abort listener and closes every socket it opened (`src/lib/market/binance.ts:255`, `src/lib/market/binance.ts:332`). Switching coins does not accumulate streams.

Zod matches a live `data-stream.binance.vision` payload captured for this review (trade `e/s/p/q/T/m`, 1s kline `k.t/i/o/h/l/c/x`). Extra fields are stripped. Acks and foreign symbols become `null`. Prices and card clocks are exchange timestamps, not a local fake tape. There is no mock price generator.

The quiet-dark pass holds. Mint and rose are candles and P&L. The Escalate chip is a dim violet pill, not a neon HUD. Nothing here needs a visual redo.

Stack matches the contract: Next, Tailwind, Framer Motion, Lightweight Charts, Zustand, Zod (`package.json`).

From this environment today: `api.binance.com` klines returned **451** in ~30ms; `data-api.binance.vision` returned 1s candles **200**. `wss://stream.binance.com:9443/ws` errored; `wss://data-stream.binance.vision/ws` delivered trades. The initial race handles that shape: HTTP 451 already fell through, and the socket race gives the preferred host 900ms before committing to vision.

## Fixes in this pass

1. **REST failover stopped at the first thrown fetch.** A 451 or 500 tried the next host. A reset, a DNS failure, a timeout, or a non-JSON body threw out of `fetchUpstreamCandles` and never called vision. `runSymbol` then marked the desk offline and never opened the trade socket (`src/lib/store.ts:223`). A blackholed `api.binance.com` blanks the show even when vision is healthy. Each host now has a 5s timeout, and a thrown attempt continues the loop (`src/lib/market/binance.ts:134`).
2. **A dead socket stuck to whichever URL won the first race.** After one successful open, reconnects called only `openKnownSocket(knownUrl)`. If that host later refused the handshake, the desk retried it forever and never raced vision again. An open failure now clears `knownUrl` so the next attempt uses the same preferred-vs-vision race as the first connect (`src/lib/market/binance.ts:301`). A clean close still retries the working host first.

Tests cover the REST reset and the 451 fallthrough, and the gross-notional cap (it was untested).

## Findings, by demo risk

### 1. Escalate will not print on a normal BTC/ETH tape

`SHOCK_MOVE_BPS` is 7 and `WIDE_VOL_BPS` is 28 (`src/lib/jev/judge.ts:27`). Seven basis points on **one** print is about $59 on BTC and does not happen between consecutive trades. A 20s capture during this review: ETH, 250 trades, loudest 7s range 0.93 bps, zero act windows, zero escalate windows. SOL produced a few sell windows. The attached shot already shows the Escalate column as “No stubs yet” while Act has fills.

The stub chrome is real (the chip, no model call, no webhook). The card is not. If the show needs an Escalate card, the thresholds have to come down. That is a product call. I did not retune them.

### 2. The judge is a local stand-in, not hosted Jev

`judgeTick` is a fixed heuristic in `src/lib/jev/judge.ts`. It imports a caps type and nothing else. No model URL, no key, no timeout, no schema for a remote judgment. Probability is `Math.round` of a hand-weighted formula (`src/lib/jev/judge.ts:175`), not a model score.

The shape still teaches the idea: Jev off keeps the tape and forbids new risk; Jev on emits act / wait / escalate; act can paper-fill inside caps; escalate does not trade. The wall labels that box “Jev”. Say, out loud, that this build is a typed stand-in. Otherwise the room will think they watched a hosted judge.

### 3. Coin switch hides an open position and freezes its mark

The book is kept on purpose (`src/lib/store.ts:121` only clears price fields). The feed is one symbol. Marks for the coin you left update only when you come back. The position cell is the **active** symbol only (`src/components/HudStats.tsx:18`). After a BTC short, ETH shows a flat position, cash up by the short proceeds, and a gross figure that no longer has a face. Equity for the hidden leg is last-trade, not live.

Do not switch coins after the first fill unless the line is “the book is still there; this socket is only ETH.” A multi-symbol mark feed is not a small fix. I did not build one.

### 4. Both REST hosts failing still kills the tape

If candle bootstrap throws after both hosts, `runSymbol` sets `closed` and returns (`src/lib/store.ts:223`). The trade socket, which can build candles on its own, never starts. The Reconnect button is that path’s recovery. I left it. With the timeout+failover fix, this is the “vision is down too” case, not the “Binance 451” case.

### 5. Chart axis is UTC; the clocks are local

Judgment times and the header use `formatClock` → `toLocaleTimeString` (`src/lib/format.ts:35`). Lightweight Charts treats bar times as UTC and this chart sets no `localization` formatter (`src/components/PriceChart.tsx:45`). On a UTC machine they match (the attached shot does). On a US laptop the axis and the cards disagree by hours. Set the laptop to UTC or add a formatter before the show. Not done here; it is a display choice, not a bad fill.

The headline delta is not the daily change. `sessionOpen` is the open of the oldest bootstrapped 1s candle (`src/lib/store.ts:210`), about three minutes back, and it does not roll as the chart trims. Fine for a short demo. Odd after a long one.

### 6. The strip named Tape is the judgment log

`TickerTape` renders recent decisions (`src/components/TickerTape.tsx:42`). With Jev off and no cards yet, it says “Public tape. Paper fills only.” and then sits. The live market is the chart and the headline, which keep moving. Point at the chart when you say the tape stays up. The strip going quiet is the gate, not a dead socket.

### 7. Laws besides the four numbers are not executed

`parseLaws` reads four keys with a line regex (`src/lib/laws/loadLaws.ts:39`) and ignores `forbid` / `allow` / `when`. `NeverPlaceRealOrders`, `EscalateIsStubbed`, and `JevGatesRisk` hold because the code has no order client, no outbound escalate, and the Jev check above. The panel says “Bound”. That is true of behavior. Editing the forbid lines does not change runtime. There is no law interpreter, and there should not be one for this demo. Do not imply the file is a policy engine.

Caps bind **new orders**, not mark-to-market. A rally can print Gross above $3,000. The HUD looks like a breach. It is the position growing after the fill. Worth one sentence if someone asks.

### 8. Test gap that would let a refactor trade while Jev is off

`applyOrder` rejects a frozen gate (`src/lib/paper/book.test.ts`). Nothing drives `useDesk` and asserts that `jevEnabled: false` never calls it. The store check is a boolean at the top of `maybeJudge`. A later edit can pass `gate: { type: "open" }` and the current tests stay green. Same hole for “socket abort closes the connection” and “stale generation cannot fill.” The new tests lock REST failover and the gross cap only.

### 9. Security and perf, so they are not open questions

- No secrets in the tree. Laws route returns the constitution file. Nothing private is in it.
- Market strings are parsed to numbers before they hit the DOM. A hostile kline host cannot inject markup through this UI.
- Bounds: decisions 36 (`src/lib/store.ts:348`), fills 40, candles 600 (`src/lib/store.ts:495`), ticks 7s or 500, equity points 1,800. Chart `setData` / `fitContent` runs on bootstrap and symbol change, not on each trade. `series.update` does run per trade. ETH was ~15 trades/s in the sample. That is fine for a desk. It is not an unbounded tape.
- The server Zustand module can hold the empty starting book across SSR requests. Fills happen in the browser. Irrelevant for a single-operator demo. Do not host this as a multi-user app without isolating that store.

## Punch list before a live show

1. Say the judge is a local stand-in. Do not say a hosted Jev answered.
2. Decide whether Escalate must appear. On a calm BTC tape it will not. The chip is the stub you can point at today.
3. Demo coin-switch **before** the first fill, or narrate the hidden position. Off-screen marks freeze.
4. Run the laptop clock in UTC, or accept that the chart axis and the cards will disagree.
5. If the desk opens on Offline, candle bootstrap died. Reconnect. A 451 from `api.binance.com` is normal and should already fail over to vision.
6. Leave Jev off for the first beat so the chart is obviously alive with empty lanes.

## Not bugs

- Repeated Act sells on a downtrend are the heuristic, not a stuck order. Cooldown is 2.5s (`src/lib/jev/judge.ts:31`). It will lean one way until the $1,500 symbol cap.
- Wait cards repeating “Inside the noise” means the 7s window is quieter than 1.6 bps. The judge is running.
- Short proceeds increase cash. Equity stays near the starting $10,000 when the mark equals the average. That is the book, not a missing debit.
