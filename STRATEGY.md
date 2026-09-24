# Tape Alignment + Live Jev

One page for the demo. Paper only. The desk never places an exchange order.

Say it in one breath:

**Binance tape → host features → live Jev Choice → probability → host size → LAWS gate → paper fill.**

Jev picks among four exclusive options and returns a probability for each. The host turns that probability into a dollar size and then refuses anything the caps will not allow. Jev never chooses a dollar amount. Escalate never fills.

## Sixty seconds

1. The wall is the public Binance tape (trades and 1-second candles) and a paper book. Jev starts off. The tape still moves.
2. Arm Jev. If `TYPESAFE_API_KEY` is set, the source is **Live Jev**. Otherwise it is the **Local surface**, labeled offline fallback. The toggle is on the decision feed: Live Jev / Local surface.
3. The host reads about seven seconds of tape plus the book: momentum, taker imbalance, volatility, shock, regime (`trend` or `chop`), inventory, cooldown, symbol, last price, cash room, caps remaining. That object is the whole `state`. It is not a writeup.
4. On a meaningful tape change, and at least every 2.5 seconds while armed, the server posts one Choice to `https://api.typesafe.ai/v1/systemone` (`model: jev-latest`). The browser never sees the key. Tape features are recomputed faster than the hosted call, but the Jev readout keeps each completed response together. We do not call on every 650ms tick.
5. Jev answers `act_buy`, `act_sell`, `wait`, or `escalate`, with a probability on each. The readout shows Live vs Local, the model id that answered, latency, the four probabilities, that response's regime, and its applied or blocked size line.
6. The host reads `p` on the option Jev selected.
   - `p < 0.60` → no fill. The row is recorded as wait, marked too soft.
   - `0.60–0.74` → $50
   - `0.75–0.89` → $100
   - `0.90+` → $200
7. If that order adds to a position already on the same side, multiply by `1 - 0.5 * |inventory|`. Inventory is position notional over the symbol cap, clamped to [-1, 1]. Covering or reducing does not take that haircut.
8. Clamp what remains to symbol room, gross room, cash (buys), and `max_trade_notional_usd` ($200). An act row shows `$size · p=… · bucket / lean / cap` and the same id as the paper fill.
9. Escalate is a stub. It is on the feed. It does not size, fill, or call a webhook.
10. If the key is missing, the call times out, or TypeSafe returns 401, 429, 5xx, or a body we cannot parse, the cycle is **wait**. The wall says why. The Binance tape stays up. We do not silently fill from the local scorer.

## What Jev is asked

One Choice, options exactly `act_buy`, `act_sell`, `wait`, `escalate`.

Instructions: this is a short-horizon tape-alignment desk. Follow when the regime is trend and momentum and taker imbalance agree. Prefer wait in chop. Escalate on shock or disagreement. Never invent a fill, a price, or a size.

`act_buy` opens or adds long paper risk, or covers a short. `act_sell` opens or adds short paper risk, or reduces a long. That matches the paper book: buy increases quantity, sell decreases it.

## Local surface

The Tape Alignment Surface in `src/lib/jev/surface.ts` is the offline fallback. It still scores the same four options from logits, then gates. It does not use the probability ladder. A local act is a flat clip at `max_trade_notional_usd`. Use it when there is no key, or when you want the demo to run without a hosted call.

## Gates that always win

- Jev off: no new judgment, no new fill. Marks keep running.
- Cooldown: 2.5s after a fill, the host will not fill another act. Live Jev may still return an act, but the host records it as blocked and the row says `cooldown 1.2s`.
- Caps, from `LAWS.bend`: cash $10,000, trade $200, symbol $1,500, gross $3,000. Caps bind the order, not a later mark-to-market rally.
- Minimum paper clip is $5. Below that, the row is blocked.
- Escalate never reaches the book.

## What is real

| | Real | Paper | Stub |
| --- | --- | --- | --- |
| Prices | Binance public trades and 1s klines | — | — |
| Live Jev | Hosted Choice on TypeSafe when a key is set | The fill is still paper | — |
| Local surface | — | Scores in this process | Offline fallback |
| Orders | Never sent | Buy/sell at the last trade, inside the caps | — |
| Escalate | — | A row on the feed | No page, no webhook |
| Chart | Binance prices drawn with TradingView Lightweight Charts | — | Not a TradingView terminal. The library logo is off. The chart header carries the credit |

Every paper fill stores the judgment id that caused it. The feed row and the recent fills show that id.

## Cadence

- Tape-state recomputation: about every 650ms, sooner when shock is past the line. Same window as before.
- Live call: not while a call is in flight; not twice inside 800ms; immediately on a regime change, a 1bp momentum move, a 0.15 imbalance move, a momentum sign flip, or shock crossing 1.8bp; otherwise every 2.5s.
- A 429 honors `retry-after` (capped at 60s) before the next call.
- The call itself times out at 4 seconds and fails closed to wait.

## Honest limits

Calm BTC often waits. One print is a fraction of a basis point. SOL reaches trend and shock more often. That is the tape.

Switching coins keeps the book and freezes the mark of the coin you left, because only one socket is open. Equity for that coin is stale until you come back.

The feed keeps every act, and repeats a wait after 4s or an escalate after 5s. It is a sampled tape, not an audit ledger. The book keeps 40 fills; the feed keeps 48 rows.
