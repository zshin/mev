"use client";

import { create } from "zustand";

import { liveCallDue, type TapeSignature } from "@/lib/jev/cadence";
import { requestLiveChoice } from "@/lib/jev/client";
import { jevHealthSchema, type DeskState as JevState } from "@/lib/jev/contract";
import { decidePaper, type DecisionFill } from "@/lib/jev/decide";
import { buildDeskState, clampInventory } from "@/lib/jev/deskState";
import { judgeTick, surfaceFeatures, THRESHOLDS, type JudgeAction, type Judgment } from "@/lib/jev/judge";
import { choiceJudgment, closedJudgment } from "@/lib/jev/liveJudgment";
import { classifyRegime, type Regime, type SurfaceFeatures } from "@/lib/jev/surface";
import { readTape, type TapeSnapshot } from "@/lib/jev/tape";
import { fetchCandles, streamMarket, type StreamStatus } from "@/lib/market/binance";
import type { Candle, MarketEvent, Symbol, TakerSide } from "@/lib/market/types";
import { createBook, equity, grossNotional, unrealizedPnl, type Book, type PaperCaps } from "@/lib/paper/book";

export type PriceDirection = "up" | "down" | "flat";

export type { DecisionFill };

export type SourceMode = "live" | "local";

export type TapeView = {
  symbol: Symbol;
  regime: Regime;
  features: SurfaceFeatures;
  price: number;
  time: number;
};

export type Decision = {
  id: string;
  symbol: Symbol;
  judgment: Judgment;
  price: number;
  time: number;
  fill: DecisionFill;
  sizeLine: string | null;
  choice: JudgeAction;
  choiceProbability: number;
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
  sourceMode: SourceMode;
  sourcePinned: boolean;
  jevConfigured: boolean | null;
  tapeView: TapeView | null;
  livePending: boolean;
  ensureBook: (caps: PaperCaps) => void;
  setSymbol: (symbol: Symbol) => void;
  setJevEnabled: (enabled: boolean) => void;
  setSourceMode: (mode: SourceMode) => void;
  noteJevHealth: (configured: boolean) => void;
};

const DEFAULT_CAPS: PaperCaps = {
  startingCashUsd: 10_000,
  maxTradeNotionalUsd: 200,
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
  sourceMode: "local",
  sourcePinned: false,
  jevConfigured: null,
  tapeView: null,
  livePending: false,
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
  setJevEnabled: (enabled) => {
    if (!enabled) cancelLive();
    else {
      lastLiveCallAt = 0;
      lastSignature = null;
    }
    set({ jevEnabled: enabled });
  },
  setSourceMode: (mode) => {
    cancelLive();
    lastLiveCallAt = 0;
    lastSignature = null;
    set({ sourceMode: mode, sourcePinned: true });
  },
  noteJevHealth: (configured) => {
    const state = get();
    set({
      jevConfigured: configured,
      sourceMode: state.sourcePinned ? state.sourceMode : configured ? "live" : "local",
    });
  },
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
let liveInFlight = false;
let liveAbort: AbortController | null = null;
let liveToken = 0;
let lastLiveCallAt = 0;
let liveNotBefore = 0;
let lastSignature: TapeSignature | null = null;

const LIVE_CLIENT_TIMEOUT_MS = 8_000;

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
  void loadJevHealth();
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
  cancelLive();
  if (raf !== 0) cancelAnimationFrame(raf);
  raf = 0;
  pendingTick = null;
}

async function runSymbol(symbol: Symbol, gen: number, signal: AbortSignal) {
  ticks = [];
  lastJudgeAt = 0;
  resetLiveCadence();
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

  const judgeInput = buildJudgeInput(state.book, state, snapshot, symbol, price, now);
  const elapsed = lastJudgeAt === 0 ? Number.POSITIVE_INFINITY : now - lastJudgeAt;
  const gap = Math.abs(snapshot.shockBps) >= THRESHOLDS.shockBps ? FAST_GAP_MS : JUDGMENT_GAP_MS;
  const regime = classifyRegime(snapshot.earlyMomentumBps, snapshot.lateMomentumBps, snapshot.volatilityBps);
  const rawFeatures = surfaceFeatures(judgeInput);
  const features = { ...rawFeatures, inventory: clampInventory(rawFeatures.inventory) };

  if (elapsed >= gap) {
    lastJudgeAt = now;
    useDesk.setState({ tapeView: { symbol, regime, features, price, time: now } });
    if (state.sourceMode === "local") {
      const judgment = judgeTick(judgeInput);
      settleHost({
        symbol,
        price,
        time: now,
        judgment,
        choice: judgment.action,
        choiceProbability: judgment.probability,
      });
      return;
    }
  }

  if (state.sourceMode !== "live") return;
  if (snapshot.sampleCount < THRESHOLDS.warmupPrints || snapshot.spanMs < THRESHOLDS.minSpanMs) return;

  const nextSignature: TapeSignature = {
    regime,
    momentumBps: snapshot.momentumBps,
    imbalance: snapshot.imbalance,
    shockBps: snapshot.shockBps,
  };
  if (
    !liveCallDue({
      now,
      lastCallAt: lastLiveCallAt,
      notBefore: liveNotBefore,
      inFlight: liveInFlight,
      previous: lastSignature,
      next: nextSignature,
    })
  ) {
    return;
  }

  const payload = buildDeskState({
    symbol,
    lastPrice: price,
    regime,
    features,
    positionNotionalUsd: judgeInput.positionNotionalUsd,
    cashUsd: judgeInput.cashUsd,
    grossNotionalUsd: judgeInput.grossNotionalUsd,
    symbolCapUsd: state.caps.maxSymbolNotionalUsd,
    grossCapUsd: state.caps.maxGrossNotionalUsd,
    maxTradeUsd: state.caps.maxTradeNotionalUsd,
  });
  lastLiveCallAt = now;
  lastSignature = nextSignature;
  if (!payload) {
    const judgment = closedJudgment({ reason: "malformed", latencyMs: 0, features, regime });
    settleHost({ symbol, price, time: now, judgment, choice: "wait", choiceProbability: 1 });
    return;
  }

  const token = ++liveToken;
  liveInFlight = true;
  useDesk.setState({ livePending: true });
  void runLive({ token, symbol, payload, features, regime, sentPrice: price });
}

function settleHost(input: {
  symbol: Symbol;
  price: number;
  time: number;
  judgment: Judgment;
  choice: JudgeAction;
  choiceProbability: number;
}) {
  const state = useDesk.getState();
  if (!state.book || !state.jevEnabled || state.symbol !== input.symbol) return;
  const marks = { ...state.marks, [input.symbol]: input.price };
  const id = nextDecisionId();
  const decided = decidePaper({
    judgment: input.judgment,
    choice: input.choice,
    choiceProbability: input.choiceProbability,
    book: state.book,
    symbol: input.symbol,
    price: input.price,
    time: input.time,
    judgmentId: id,
    caps: state.caps,
    marks,
    gate: { type: "open" },
    msSinceLastAct: lastActAt === 0 ? Number.POSITIVE_INFINITY : input.time - lastActAt,
    cooldownMs: THRESHOLDS.actCooldownMs,
  });
  if (decided.filled) lastActAt = input.time;
  const decision: Decision = {
    id,
    symbol: input.symbol,
    judgment: decided.judgment,
    price: input.price,
    time: input.time,
    fill: decided.fill,
    sizeLine: decided.sizeLine,
    choice: input.choice,
    choiceProbability: input.choiceProbability,
  };
  const record = shouldRecord(decided.judgment.action, input.symbol, input.time);
  if (record) lastCard = { action: decided.judgment.action, symbol: input.symbol, time: input.time };
  if (decided.filled) paintEquity(equity(decided.book, marks), input.time, true);
  const fresh = useDesk.getState();
  useDesk.setState({
    book: decided.book,
    marks,
    equityUsd: equity(decided.book, marks),
    unrealizedUsd: unrealizedPnl(decided.book, marks),
    latest: decision,
    decisions: record ? [decision, ...fresh.decisions].slice(0, 48) : fresh.decisions,
  });
}

function buildJudgeInput(
  book: Book,
  state: { jevEnabled: boolean; caps: PaperCaps; marks: Partial<Record<Symbol, number>> },
  snapshot: TapeSnapshot,
  symbol: Symbol,
  price: number,
  now: number,
) {
  const position = book.positions[symbol];
  const marks = { ...state.marks, [symbol]: price };
  return {
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
    grossNotionalUsd: grossNotional(book, marks),
    cashUsd: book.cashUsd,
    msSinceLastAct: lastActAt === 0 ? Number.POSITIVE_INFINITY : now - lastActAt,
    jevEnabled: state.jevEnabled,
    caps: state.caps,
  };
}

async function runLive(input: {
  token: number;
  symbol: Symbol;
  payload: JevState;
  features: SurfaceFeatures;
  regime: Regime;
  sentPrice: number;
}) {
  const controller = new AbortController();
  liveAbort = controller;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, LIVE_CLIENT_TIMEOUT_MS);
  try {
    const result = await requestLiveChoice(input.payload, controller.signal);
    if (!liveStillCurrent(input.token, input.symbol)) return;
    if (result.type === "closed" && result.reason === "rate-limited" && result.retryAfterMs !== null) {
      liveNotBefore = Date.now() + result.retryAfterMs;
    }
    const judgment =
      result.type === "choice"
        ? choiceJudgment({ choice: result, features: input.features, regime: input.regime })
        : closedJudgment({
            reason: result.reason,
            latencyMs: result.latencyMs,
            features: input.features,
            regime: input.regime,
          });
    const choice = result.type === "choice" ? result.action : "wait";
    const choiceProbability = result.type === "choice" ? result.optionScores[result.action] : 1;
    const price = useDesk.getState().lastPrice ?? input.sentPrice;
    settleHost({ symbol: input.symbol, price, time: Date.now(), judgment, choice, choiceProbability });
  } catch (error) {
    if (!liveStillCurrent(input.token, input.symbol)) return;
    if (!timedOut && isAbortError(error)) return;
    const judgment = closedJudgment({
      reason: timedOut ? "timeout" : "unavailable",
      latencyMs: timedOut ? LIVE_CLIENT_TIMEOUT_MS : 0,
      features: input.features,
      regime: input.regime,
    });
    const price = useDesk.getState().lastPrice ?? input.sentPrice;
    settleHost({ symbol: input.symbol, price, time: Date.now(), judgment, choice: "wait", choiceProbability: 1 });
  } finally {
    clearTimeout(timer);
    if (input.token === liveToken) {
      liveInFlight = false;
      liveAbort = null;
      if (useDesk.getState().livePending) useDesk.setState({ livePending: false });
    }
  }
}

function liveStillCurrent(token: number, symbol: Symbol): boolean {
  const state = useDesk.getState();
  return token === liveToken && state.jevEnabled && state.sourceMode === "live" && state.symbol === symbol;
}

function cancelLive() {
  liveToken += 1;
  liveAbort?.abort();
  liveAbort = null;
  liveInFlight = false;
  if (useDesk.getState().livePending) useDesk.setState({ livePending: false });
}

function resetLiveCadence() {
  cancelLive();
  lastLiveCallAt = 0;
  lastSignature = null;
}

function loadJevHealth(): Promise<void> {
  return fetch("/api/jev/health", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return;
      const body: unknown = await response.json();
      const parsed = jevHealthSchema.safeParse(body);
      if (!parsed.success) return;
      useDesk.getState().noteJevHealth(parsed.data.configured);
    })
    .catch(() => undefined);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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
