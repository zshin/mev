# Tape Alignment Surface — adversarial review

Verdict: **ship-with-fixes** for a controlled live demo. **Do not merge from this review.**

The Surface is not a renamed first-match judge. It computes four logits, applies inventory pressure, floors illegal acts, softmaxes the gated logits, and selects the maximum (`src/lib/jev/surface.ts:226`, `src/lib/jev/surface.ts:273`, `src/lib/jev/surface.ts:400`). The remaining risks are mostly state/history claims around that core, not fake scoring.

## What holds

- **Paper only.** The only network paths are fixed public Binance REST/WebSocket hosts (`src/lib/market/binance.ts:5`, `src/lib/market/binance.ts:7`). There is no exchange client, signing code, account endpoint, key lookup, wallet, or order route.
- **Jev-off cannot fill.** The store stops before judging (`src/lib/store.ts:280`) and re-reads the live toggle immediately before `applyOrder`, passing a frozen gate if it changed (`src/lib/store.ts:313`). The book rejects a frozen gate before touching exposure (`src/lib/paper/book.ts:95`).
- **The Surface is scored and gated.** Trend/chop changes the logits, aligned taker flow changes the favored side, inventory subtracts from adding to the held side, and shock/fight/whipsaw/wide-range conditions add to Escalate (`src/lib/jev/surface.ts:226`). Cooldown floors both acts; symbol, gross, and cash checks floor the affected act (`src/lib/jev/surface.ts:273`). The paper book independently clamps trade, symbol, gross, and cash exposure (`src/lib/paper/book.ts:104`, `src/lib/paper/book.ts:153`).
- **Regime is reachable both ways.** Trend requires two same-sign half-window moves of at least 0.7 bps and range below 4 bps; everything else is chop (`src/lib/jev/surface.ts:132`). Tests exercise positive trend, negative trend, and several chop shapes.
- **Displayed probabilities are the gated probabilities.** `probability` is read from `optionScores[action]` after softmax and rounding (`src/lib/jev/surface.ts:174`, `src/lib/jev/surface.ts:400`). The feature line is the actual input snapshot. Drivers are short explanations, not a numerical decomposition of every logit.
- **Escalate is a stub.** Only `act_buy` and `act_sell` map to an order side (`src/lib/store.ts:362`). Escalate can be selected and recorded but cannot call the book.
- **A fill and its creating decision are atomic and share one id.** The generated id is passed into the paper order, copied into the fill, and put on the same decision before the single store update (`src/lib/store.ts:308`, `src/lib/store.ts:326`, `src/lib/store.ts:332`, `src/lib/store.ts:342`).
- **Chart branding is accurate in the product.** Prices are Binance data. Lightweight Charts has `attributionLogo: false`, while the chart header visibly says and links “TradingView Lightweight Charts” (`src/components/PriceChart.tsx:40`, `src/components/PriceChart.tsx:126`). The UI does not call itself a TradingView terminal.

## Tiny contract fixes in this review

1. Warmup and short-window holds previously returned hard-coded probabilities before `applyGates` and `softmax`, contradicting “every option score is post-gate.” They now softmax a hold prior through the same hard gates (`src/lib/jev/surface.ts:157`, `src/lib/jev/surface.ts:184`).
2. The “current” Surface could show the prior symbol after a coin switch or an old Act after Jev was turned off. The readout now accepts only an armed judgment for the active symbol (`src/components/DecisionFeed.tsx:29`, `src/components/DecisionFeed.tsx:80`).
3. Wait/Escalate repeat suppression was global across symbols, so the first SOL Wait could disappear because BTC had just waited. The throttle key now includes symbol (`src/lib/store.ts:148`, `src/lib/store.ts:349`, `src/lib/store.ts:378`).

## Findings ranked by demo risk

### 1. High — coin switch still hides and stale-marks open positions

`setSymbol` keeps the shared book but clears only active price fields (`src/lib/store.ts:122`). There is one active market stream, so marks for the coin left behind freeze. The position cell renders only `book.positions[symbol]` (`src/components/HudStats.tsx:18`).

Reproduction: fill a BTC short, switch to ETH, then let BTC move. ETH can show a flat active position while cash and gross still include BTC; total equity uses BTC's last mark. That is internally consistent for a single-stream book but visually looks like a missing position and live P&L is stale.

Before stage: switch coins before the first fill, or explicitly say “the book is multi-symbol, but this demo marks only the selected socket.” A real fix needs concurrent marks or an all-position panel; it is not a tiny patch.

### 2. Medium — fill/decision links are not retained as a pair

The book retains 40 fills (`src/lib/paper/book.ts:148`) while the feed independently retains 48 recorded decisions (`src/lib/store.ts:358`). Therefore the id is correct at creation, but visible history is not referentially complete.

- After one fill, more than 48 recorded Wait/Escalate transitions can evict its decision while the fill remains in the book.
- After more than 48 acts, the feed can retain filled decisions whose fills have already fallen out of the 40-fill ring.

The HUD only shows the newest three fills, so normal demos are unlikely to hit this. Do not claim the bounded histories form an audit ledger. If that claim matters, retain linked records together or derive both views from one event log.

### 3. Medium — the store-level safety contract is not integration-tested

Pure tests cover Surface gates and the book's frozen gate, but no test drives `maybeJudge` through the Zustand store and proves: Jev-off never fills, stale-generation events cannot fill after a switch, each filled decision has the same book id, every Act is recorded, and Escalate never calls `applyOrder`.

These are the highest-value regression tests because the safety guarantee currently depends on wiring in `src/lib/store.ts`, not only the tested pure functions. A refactor could bypass the correct book/Surface units and stay green.

### 4. Low — the “sequential feed” is intentionally lossy

Every Act is recorded (`src/lib/store.ts:382`). Wait is sampled at most every 4s and Escalate every 5s while the same symbol/action repeats (`src/lib/store.ts:378`). `latest` still updates each judged cycle, but `decisions` is not a complete judgment ledger.

Say “chronological sampled feed” or “one feed, newest first,” not “every judgment.” Filters and counts apply only to retained rows.

### 5. Low — Jev-off is a pre-score stop in the running desk

Although `judgeTick` can mathematically gate Jev-off acts, the store returns before calling it while the toggle is off (`src/lib/store.ts:280`). This is safe and matches the README statement that off freezes judgments. It does mean the live demo is not continuously scoring a hidden Surface and then showing an off-gated probability.

Say “Jev-off stops judgment and freezes new paper risk.” Do not say the visible off-state bars are a scored cycle.

### 6. Low — total candle-bootstrap failure still prevents the live socket

If both REST hosts fail, `runSymbol` marks the desk closed and returns before opening the trade socket (`src/lib/store.ts:208`, `src/lib/store.ts:227`). The prior host failover fixes cover the common 451/dead-host cases, but simultaneous REST failure still blanks a socket that might otherwise be healthy.

Use Reconnect if the wall opens Offline. Do not debug this on stage.

### 7. Low — chart and card clocks can disagree outside UTC

Cards use local `toLocaleTimeString`; Lightweight Charts receives UTC timestamps and no custom localization formatter (`src/lib/format.ts:35`, `src/components/PriceChart.tsx:32`). The supplied screenshot is on UTC and aligns. A non-UTC demo laptop can show different hours on the axis and feed.

## Other wording traps

- `LAWS.bend` is not interpreted. Only four numeric caps are parsed (`src/lib/laws/loadLaws.ts:22`); the forbid/allow prose holds because code implements it separately.
- Gross caps bind order entry, not later mark-to-market. A rally can display gross above $3,000 without a cap bypass.
- The top strip labeled Tape is recent judgments, not raw trades (`src/components/TickerTape.tsx:42`). The chart/headline are the proof that public tape stays live.
- Short-sale proceeds increase cash. Equity, not cash alone, is the account value.
- A quiet BTC window may never Escalate. The screenshot proves SOL can produce Act/Wait; it does not prove all four actions occur in every session.

## Punch list before a live show

1. Say: “local typed stand-in, not hosted Jev; Binance prices; paper fills only.”
2. Leave Jev off first to prove the chart moves without judgments or fills, then arm it.
3. Use SOL if mixed outcomes matter; never promise Escalate on demand.
4. Switch symbols before the first fill. After a fill, stay on that symbol.
5. Call the bottom list a sampled chronological feed, not an audit log.
6. Use a UTC machine/window if feed and chart-axis times must match.
7. If Offline appears, press Reconnect once; have the supplied screenshot/video ready.
