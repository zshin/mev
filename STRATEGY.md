# Tape Alignment Surface

One page for the demo. This desk does not predict the next tick. Each cycle it scores four exclusive options, turns the scores into probabilities, and lets the hard gates win.

It is a **typed local stand-in** shaped like Jev: options, probabilities, then a verdict gate. It is not a hosted Jev call. No API key. No real order.

## The story

```
live tape + paper book
  → features
  → regime (trend | chop)
  → logit for act_buy, act_sell, wait, escalate
  → hard gate (Jev, cooldown, caps, cash)
  → softmax probability
  → action
```

Say it as: **inputs → Surface scores → probability → gated action.**

The four numbers in `optionScores` are the probabilities after the gate. They sum to 1. `probability` is the weight of the chosen action.

The live **Surface** stack is the current cycle. The **Decisions** feed is the sequential log, newest first. Acts are always kept. A repeated wait is kept again after 4s, a repeated escalate after 5s, so a quiet tape does not flood the wall. The stack still moves on every cycle (about 650ms, faster when shock is past the line).

## Inputs

All of these are on the card. They come from the live Binance window (about 7 seconds) and the paper book.

| Feature | Meaning |
| --- | --- |
| `momentumBps` | Return from the first print in the window to the last |
| `imbalance` | Taker buy quantity minus taker sell quantity, over the total. About +1 is all lifting, −1 is all hitting |
| `volatilityBps` | High minus low of the window, in bps of the last price |
| `shockBps` | The sharp end of the window. The larger of the last trade-to-trade print and the trailing 1 second. On BTC one print is often a single tick, well under 1 bp, so the 1s burst is the shock a person can see |
| `regime` | `trend` or `chop` |
| `inventory` | Signed position notional divided by the symbol cap. +1 is a full long |
| `cooldown` | Milliseconds since the last paper act. The card says `ready` once that is at least 2.5s |

## Regime

**Trend** when both halves of the window share a sign, each half moved at least **0.7 bps**, and the range is under **4 bps**.

**Chop** otherwise. A push that is only in one half is chop. We do not chase it.

## What each regime prefers

- **Trend.** Follow when momentum and taker imbalance agree and vol is still clean. Inventory leans against adding to a side you already hold.
- **Chop.** Prefer wait. A small chase exists in the score and loses to wait unless the tape stops being chop.
- **Escalate** (stub, never a fill) when any of these clear the wait prior:
  - shock at least **1.8 bps**
  - momentum and taker fight: |momentum| ≥ **1.5 bps** and |imbalance| ≥ **0.28**, opposite signs
  - the window reverses: halves oppose, each at least **0.9 bps**
  - chop range at least **4.5 bps**
- **Wait** for warmup (under 12 prints), a window shorter than 1.5s, inside the noise (|momentum| under 1.15 bps and no escalate kick), cooldown, or a binding cap.

Calm BTC often sits in wait. One print there is worth a fraction of a basis point, so escalate is uncommon until the 1s burst, a reversal, or a real disagreement shows up. SOL reaches those lines more often. That is the tape, not a hidden coin rule. Thresholds live in `THRESHOLDS` in `src/lib/jev/surface.ts`. The formulas are in the comment above them.

## Gates

Softmax runs **after** the gate. An illegal act is floored, so its probability collapses and the mass sits on wait or escalate.

The gate blocks an act when:

- Jev is off
- the last act was under 2.5s ago (`cooldown 2.1s` and `surface leaned buy` or `sell`)
- the symbol cap or the gross cap has under $5 of room
- a buy would need cash and cash is under $5

Reducing a position is not treated as a new cap breach. Escalate never calls the paper book. `LAWS.bend` still supplies the four numbers. The other lines in that file are not a policy engine. There is no order client.

## What is real

| | Real | Paper | Stub |
| --- | --- | --- | --- |
| Prices | Binance public trades and 1s klines | — | — |
| Decision Surface | — | Local scores in this process | — |
| Orders | Never sent | Buy/sell at the last trade, inside the caps | — |
| Escalate | — | A row on the feed | No model, no page, no webhook |
| Chart | Binance prices drawn with TradingView Lightweight Charts | — | Not a TradingView terminal. The library logo is off. The chart header carries the credit and link |

Every paper fill stores the judgment id that caused it. The feed row and the paper book’s recent fills show that id.
