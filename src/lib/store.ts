"use client";

import { create } from "zustand";

import { judgeTick, THRESHOLDS, type JudgeAction, type Judgment } from "@/lib/jev/judge";
import { readTape } from "@/lib/jev/tape";
import { fetchCandles, streamMarket, type StreamStatus } from "@/lib/market/binance";
import type { Candle, MarketEvent, Symbol, TakerSide } from "@/lib/market/types";
import {
  applyOrder,
  createBook,
  equity,
  grossNotional,
  unrealizedPnl,
  type Book,
  type PaperCaps,
} from "@/lib/paper/book";

export type PriceDirection = "up" | "down" | "flat";

export type DecisionFill =
  | { type: "filled"; notionalUsd: number; judgmentId: string }
  | { type: "rejected"; reason: string }
  | { type: "none" };

export type Decision = {
  id: string;
  symbol: Symbol;
  judgment: Judgment;
  price: number;
  time: number;
  fill: DecisionFill;
};

export type EquityPoint = {
  time: number;
  value: number;
};

type Tick = {
  time: number;
  price: number;
  qty: number;
  taker: TakerSide;
  symbol: Symbol;
};

type CandleBinding = {
  setData: (candles: Candle[]) => void;
  update: (candle: Candle) => void;
};

type EquityBinding = {
  setData: (points: EquityPoint[]) => void;
  update: (point: EquityPoint) => void;
};

type DeskState = {
  symbol: Symbol;
  jevEnabled: boolean;
  status: StreamStatus;
  error: string | null;
  lastPrice: number | null;
  sessionOpen: number | null;
  lastTaker: TakerSide | null;
  priceDirection: PriceDirection;
  book: Book | null;
  caps: PaperCaps;
  marks: Partial<Record<Symbol, number>>;
  equityUsd: number;
  unrealizedUsd: number;
  latest: Decision | null;
  decisions: Decision[];
  ensureBook: (caps: PaperCaps) => void;
  setSymbol: (symbol: Symbol) => void;
  setJevEnabled: (enabled: boolean) => void;
};

const DEFAULT_CAPS: PaperCaps = {
  startingCashUsd: 10_000,
  maxTradeNotionalUsd: 100,
  maxSymbolNotionalUsd: 1_500,
  maxGrossNotionalUsd: 3_000,
};

const WINDOW_MS = 7_000;
const JUDGMENT_GAP_MS = 650;
const FAST_GAP_MS = 420;
const WAIT_REPEAT_MS = 4_000;
const ESCALATE_REPEAT_MS = 5_000;

export const useDesk = create<DeskState>((set, get) => ({
  symbol: "BTCUSDT",
  jevEnabled: false,
  status: { type: "connecting", host: "stream.binance.com" },
  error: null,
  lastPrice: null,
  sessionOpen: null,
  lastTaker: null,
  priceDirection: "flat",
  book: null,
  caps: DEFAULT_CAPS,
  marks: {},
  equityUsd: DEFAULT_CAPS.startingCashUsd,
  unrealizedUsd: 0,
  latest: null,
  decisions: [],
  ensureBook: (caps) => {
    const current = get().book;
    if (current) {
      set({ caps });
      return;
    }
    const book = createBook(caps.startingCashUsd);
    set({
      caps,
      book,
      equityUsd: book.cashUsd,
      unrealizedUsd: 0,
    });
  },
  setSymbol: (symbol) => {
    if (get().symbol === symbol) return;
    set({
      symbol,
      lastPrice: null,
      sessionOpen: null,
      lastTaker: null,
      priceDirection: "flat",
    });
    if (feedStarted) startFeed();
  },
  setJevEnabled: (enabled) => set({ jevEnabled: enabled }),
}));

let candles: Candle[] = [];
let equityPoints: EquityPoint[] = [];
let ticks: Tick[] = [];
let priceBinding: CandleBinding | null = null;
let equityBinding: EquityBinding | null = null;
let activeAbort: AbortController | null = null;
let feedGen = 0;
let feedStarted = false;
let raf = 0;
let pendingTick: Tick | null = null;
let lastJudgeAt = 0;
let lastActAt = 0;
let lastCard: { action: Judgment["action"]; symbol: Symbol; time: number } | null = null;
let lastEquityPaint = 0;
let decisionSeq = 0;

export function bindPriceChart(binding: CandleBinding | null) {
  priceBinding = binding;
  if (binding) binding.setData(candles);
}

export function bindEquityChart(binding: EquityBinding | null) {
  equityBinding = binding;
  if (binding) binding.setData(equityPoints);
}

export function bootDesk(caps: PaperCaps): () => void {
  useDesk.getState().ensureBook(caps);
  startFeed();
  return stopFeed;
}

export function restartFeed() {
  startFeed();
}

function startFeed() {
  stopStream();
  feedStarted = true;
  feedGen += 1;
  const gen = feedGen;
  const controller = new AbortController();
  activeAbort = controller;
  void runSymbol(useDesk.getState().symbol, gen, controller.signal);
}

function stopFeed() {
  feedStarted = false;
  stopStream();
}

function stopStream() {
  feedGen += 1;
  activeAbort?.abort();
  activeAbort = null;
  if (raf !== 0) cancelAnimationFrame(raf);
  raf = 0;
  pendingTick = null;
}

async function runSymbol(symbol: Symbol, gen: number, signal: AbortSignal) {
  ticks = [];
  lastJudgeAt = 0;
  replaceCandles([]);
  useDesk.setState({
    status: { type: "connecting", host: "stream.binance.com" },
    error: null,
    lastPrice: null,
    sessionOpen: null,
  });

  try {
    const bootstrap = await fetchCandles(symbol, 180, signal);
    if (stale(gen, signal, symbol)) return;
    replaceCandles(bootstrap.candles);
    const sessionOpen = bootstrap.candles[0]?.open ?? null;
    const lastPrice = bootstrap.candles.at(-1)?.close ?? null;
    const state = useDesk.getState();
    const marks = lastPrice === null ? state.marks : { ...state.marks, [symbol]: lastPrice };
    const book = state.book;
    useDesk.setState({
      sessionOpen,
      lastPrice,
      marks,
      equityUsd: book ? equity(book, marks) : state.equityUsd,
      unrealizedUsd: book ? unrealizedPnl(book, marks) : 0,
      status: { type: "connecting", host: bootstrap.host },
    });
  } catch (error) {
    if (signal.aborted || gen !== feedGen) return;
    useDesk.setState({
      status: { type: "closed", reason: "bootstrap failed" },
      error: error instanceof Error ? error.message : "Bootstrap failed",
    });
    return;
  }

  await streamMarket({
    symbol,
    signal,
    onStatus: (status) => {
      if (gen !== feedGen) return;
      useDesk.setState({ status, error: null });
    },
    onEvent: (event) => {
      if (stale(gen, signal, symbol)) return;
      handleEvent(event);
    },
  });
}

function handleEvent(event: MarketEvent) {
  switch (event.type) {
    case "trade":
      ticks.push({
        time: event.time,
        price: event.price,
        qty: event.qty,
        taker: event.taker,
        symbol: event.symbol,
      });
      trimTicks(event.time);
      applyTradeToCandle(event.price, event.time);
      scheduleMark(ticks.at(-1) ?? null);
      maybeJudge(event.time, event.price, event.symbol);
      return;
    case "kline":
      upsertCandle({
        time: event.time,
        open: event.open,
        high: event.high,
        low: event.low,
        close: event.close,
      });
      return;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

function maybeJudge(now: number, price: number, symbol: Symbol) {
  const state = useDesk.getState();
  if (!state.jevEnabled || !state.book) return;
  const snapshot = readTape(ticks);
  if (!snapshot || snapshot.sampleCount < 4 || snapshot.spanMs < 400) return;
  const elapsed = lastJudgeAt === 0 ? Number.POSITIVE_INFINITY : now - lastJudgeAt;
  const gap = Math.abs(snapshot.shockBps) >= THRESHOLDS.shockBps ? FAST_GAP_MS : JUDGMENT_GAP_MS;
  if (elapsed < gap) return;

  lastJudgeAt = now;
  const position = state.book.positions[symbol];
  const marks = { ...state.marks, [symbol]: price };
  const judgment = judgeTick({
    sampleCount: snapshot.sampleCount,
    spanMs: snapshot.spanMs,
    momentumBps: snapshot.momentumBps,
    imbalance: snapshot.imbalance,
    volatilityBps: snapshot.volatilityBps,
    shockBps: snapshot.shockBps,
    shockSource: snapshot.shockSource,
    earlyMomentumBps: snapshot.earlyMomentumBps,
    lateMomentumBps: snapshot.lateMomentumBps,
    positionNotionalUsd: position.qty * price,
    grossNotionalUsd: grossNotional(state.book, marks),
    cashUsd: state.book.cashUsd,
    msSinceLastAct: lastActAt === 0 ? Number.POSITIVE_INFINITY : now - lastActAt,
    jevEnabled: state.jevEnabled,
    caps: state.caps,
  });

  const id = nextDecisionId();
  const side = orderSide(judgment.action);
  let book = state.book;
  let fill: DecisionFill = { type: "none" };
  if (side) {
    const live = useDesk.getState();
    const gate = live.jevEnabled
      ? ({ type: "open" } as const)
      : ({ type: "frozen", reason: "Jev is off" } as const);
    const result = applyOrder(
      book,
      {
        type: side,
        symbol,
        notionalUsd: live.caps.maxTradeNotionalUsd,
        price,
        time: now,
        judgmentId: id,
      },
      live.caps,
      gate,
      marks,
    );
    if (result.type === "filled") {
      book = result.book;
      fill = { type: "filled", notionalUsd: result.fill.notionalUsd, judgmentId: result.fill.judgmentId };
      lastActAt = now;
      paintEquity(equity(book, marks), now, true);
    } else {
      fill = { type: "rejected", reason: result.reason };
    }
  }

  const decision: Decision = {
    id,
    symbol,
    judgment,
    price,
    time: now,
    fill,
  };
  const record = shouldRecord(judgment.action, symbol, now);
  if (record) lastCard = { action: judgment.action, symbol, time: now };
  const fresh = useDesk.getState();
  useDesk.setState({
    book,
    marks,
    equityUsd: equity(book, marks),
    unrealizedUsd: unrealizedPnl(book, marks),
    latest: decision,
    decisions: record ? [decision, ...fresh.decisions].slice(0, 48) : fresh.decisions,
  });
}

function orderSide(action: JudgeAction): "buy" | "sell" | null {
  switch (action) {
    case "act_buy":
      return "buy";
    case "act_sell":
      return "sell";
    case "wait":
    case "escalate":
      return null;
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

function shouldRecord(action: Judgment["action"], symbol: Symbol, now: number): boolean {
  if (!lastCard || lastCard.action !== action || lastCard.symbol !== symbol) return true;
  switch (action) {
    case "act_buy":
    case "act_sell":
      return true;
    case "wait":
      return now - lastCard.time >= WAIT_REPEAT_MS;
    case "escalate":
      return now - lastCard.time >= ESCALATE_REPEAT_MS;
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

function scheduleMark(tick: Tick | null) {
  if (!tick) return;
  pendingTick = tick;
  if (raf !== 0) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const next = pendingTick;
    pendingTick = null;
    if (!next) return;
    const state = useDesk.getState();
    if (state.symbol !== next.symbol) return;
    const book = state.book;
    const marks = { ...state.marks, [next.symbol]: next.price };
    useDesk.setState({
      lastPrice: next.price,
      lastTaker: next.taker,
      priceDirection: priceDirection(state.lastPrice, next.price),
      marks,
      equityUsd: book ? equity(book, marks) : state.equityUsd,
      unrealizedUsd: book ? unrealizedPnl(book, marks) : state.unrealizedUsd,
    });
    if (book && book.tradeCount > 0) paintEquity(equity(book, marks), next.time, false);
  });
}

function paintEquity(value: number, timeMs: number, force: boolean) {
  if (!force && timeMs - lastEquityPaint < 250 && equityPoints.length > 0) return;
  lastEquityPaint = timeMs;
  const time = Math.floor(timeMs / 1000);
  const starting = useDesk.getState().book?.startingCashUsd ?? value;
  if (equityPoints.length === 0) {
    const start = Math.max(0, time - 1);
    equityPoints = [
      { time: start, value: starting },
      { time: Math.max(time, start + 1), value },
    ];
    equityBinding?.setData(equityPoints);
    return;
  }
  const last = equityPoints.at(-1);
  if (!last || time < last.time) return;
  const point = { time, value };
  if (time === last.time) equityPoints[equityPoints.length - 1] = point;
  else {
    equityPoints.push(point);
    if (equityPoints.length > 1_800) equityPoints.splice(0, equityPoints.length - 1_800);
  }
  equityBinding?.update(point);
}

function trimTicks(now: number) {
  const cutoff = now - WINDOW_MS;
  while (ticks.length > 0) {
    const first = ticks[0];
    if (!first || first.time >= cutoff) break;
    ticks.shift();
  }
  if (ticks.length > 500) ticks.splice(0, ticks.length - 500);
}

function applyTradeToCandle(price: number, timeMs: number) {
  const time = Math.floor(timeMs / 1000);
  const last = candles.at(-1);
  if (!last || time > last.time) {
    const seed = last ? last.close : price;
    upsertCandle({
      time,
      open: seed,
      high: Math.max(seed, price),
      low: Math.min(seed, price),
      close: price,
    });
    return;
  }
  if (time === last.time) {
    upsertCandle({
      time,
      open: last.open,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
      close: price,
    });
  }
}

function upsertCandle(candle: Candle) {
  const last = candles.at(-1);
  if (!last || candle.time > last.time) {
    candles.push(candle);
    if (candles.length > 600) candles.splice(0, candles.length - 600);
    priceBinding?.update(candle);
    return;
  }
  if (candle.time === last.time) {
    candles[candles.length - 1] = candle;
    priceBinding?.update(candle);
  }
}

function replaceCandles(next: Candle[]) {
  candles = next.slice(-600);
  priceBinding?.setData(candles);
}

function priceDirection(previous: number | null, next: number): PriceDirection {
  if (previous === null || previous === next) return "flat";
  return next > previous ? "up" : "down";
}

function nextDecisionId(): string {
  decisionSeq += 1;
  return `d${decisionSeq.toString(36)}`;
}

function stale(gen: number, signal: AbortSignal, symbol: Symbol): boolean {
  return signal.aborted || gen !== feedGen || useDesk.getState().symbol !== symbol;
}
