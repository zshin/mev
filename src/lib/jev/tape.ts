import type { TakerSide } from "@/lib/market/types";

/** Trailing burst compared with the last print when naming `shockBps`. */
export const SHOCK_WINDOW_MS = 1_000;

export type TapePrint = {
  time: number;
  price: number;
  qty: number;
  taker: TakerSide;
};

export type ShockSource = "print" | "burst";

export type TapeSnapshot = {
  sampleCount: number;
  spanMs: number;
  momentumBps: number;
  imbalance: number;
  volatilityBps: number;
  shockBps: number;
  shockSource: ShockSource;
  earlyMomentumBps: number;
  lateMomentumBps: number;
};

/**
 * Reads one judgment window off the live tape.
 *
 * `shockBps` is the sharp end of that window: the larger absolute move between
 * the last trade-to-trade print and the trailing {@link SHOCK_WINDOW_MS}
 * burst. On BTC a single print is often one tick, far under a basis point, so
 * the burst is what a person means by a shock. The source is reported so the
 * desk can say which one fired.
 */
export function readTape(ticks: readonly TapePrint[]): TapeSnapshot | null {
  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  if (!first || !last || !(first.price > 0) || !(last.price > 0)) return null;

  let buy = 0;
  let sell = 0;
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  for (const tick of ticks) {
    switch (tick.taker) {
      case "buy":
        buy += tick.qty;
        break;
      case "sell":
        sell += tick.qty;
        break;
      default: {
        const unreachable: never = tick.taker;
        return unreachable;
      }
    }
    if (tick.price > high) high = tick.price;
    if (tick.price < low) low = tick.price;
  }
  const total = buy + sell;
  const previous = ticks.length >= 2 ? ticks[ticks.length - 2] : undefined;
  const lastPrintBps = previous ? moveBps(previous.price, last.price) : 0;
  const burstFrom = priceAtOrBefore(ticks, last.time - SHOCK_WINDOW_MS);
  const burstBps = moveBps(burstFrom, last.price);
  const useBurst = Math.abs(burstBps) > Math.abs(lastPrintBps);
  const halves = halfMomenta(ticks);

  return {
    sampleCount: ticks.length,
    spanMs: last.time - first.time,
    momentumBps: moveBps(first.price, last.price),
    imbalance: total > 0 ? (buy - sell) / total : 0,
    volatilityBps: last.price > 0 ? ((high - low) / last.price) * 10_000 : 0,
    shockBps: useBurst ? burstBps : lastPrintBps,
    shockSource: useBurst ? "burst" : "print",
    earlyMomentumBps: halves.earlyMomentumBps,
    lateMomentumBps: halves.lateMomentumBps,
  };
}

function halfMomenta(ticks: readonly TapePrint[]): { earlyMomentumBps: number; lateMomentumBps: number } {
  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  if (!first || !last) return { earlyMomentumBps: 0, lateMomentumBps: 0 };
  const mid = first.time + (last.time - first.time) / 2;
  let earlyEnd = first;
  let lateStart = last;
  let foundLate = false;
  for (const tick of ticks) {
    if (tick.time <= mid) earlyEnd = tick;
    if (!foundLate && tick.time >= mid) {
      lateStart = tick;
      foundLate = true;
    }
  }
  return {
    earlyMomentumBps: moveBps(first.price, earlyEnd.price),
    lateMomentumBps: moveBps(lateStart.price, last.price),
  };
}

function priceAtOrBefore(ticks: readonly TapePrint[], time: number): number {
  const first = ticks[0];
  if (!first) return 0;
  let price = first.price;
  for (const tick of ticks) {
    if (tick.time > time) break;
    price = tick.price;
  }
  return price;
}

function moveBps(from: number, to: number): number {
  if (!(from > 0) || !Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return ((to - from) / from) * 10_000;
}
