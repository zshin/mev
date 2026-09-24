import { SYMBOLS, type Symbol } from "@/lib/market/types";

export type PaperCaps = {
  startingCashUsd: number;
  maxTradeNotionalUsd: number;
  maxSymbolNotionalUsd: number;
  maxGrossNotionalUsd: number;
};

export type Position = {
  qty: number;
  avgPrice: number;
};

export type PaperFill = {
  type: "buy" | "sell";
  symbol: Symbol;
  price: number;
  qty: number;
  notionalUsd: number;
  realizedPnlUsd: number;
  time: number;
  judgmentId: string;
};

export type Book = {
  startingCashUsd: number;
  cashUsd: number;
  realizedPnlUsd: number;
  tradeCount: number;
  positions: Record<Symbol, Position>;
  fills: PaperFill[];
};

export type PaperOrder =
  | { type: "buy"; symbol: Symbol; notionalUsd: number; price: number; time: number; judgmentId: string }
  | { type: "sell"; symbol: Symbol; notionalUsd: number; price: number; time: number; judgmentId: string };

export type RiskGate = { type: "open" } | { type: "frozen"; reason: string };

export type ApplyResult =
  | { type: "filled"; book: Book; fill: PaperFill }
  | { type: "rejected"; book: Book; reason: string };

export type ExposureBind = "max-trade" | "symbol" | "gross" | "cash";

export type FitNotional =
  | { type: "ok"; notionalUsd: number; deltaQty: number; binds: ExposureBind[] }
  | { type: "rejected"; reason: string };

const MIN_NOTIONAL_USD = 5;

export function createBook(startingCashUsd: number): Book {
  return {
    startingCashUsd,
    cashUsd: startingCashUsd,
    realizedPnlUsd: 0,
    tradeCount: 0,
    positions: emptyPositions(),
    fills: [],
  };
}

export function equity(book: Book, marks: Partial<Record<Symbol, number>>): number {
  let value = book.cashUsd;
  for (const symbol of SYMBOLS) {
    const position = book.positions[symbol];
    const mark = marks[symbol] ?? position.avgPrice;
    value += position.qty * mark;
  }
  return value;
}

export function unrealizedPnl(book: Book, marks: Partial<Record<Symbol, number>>): number {
  let pnl = 0;
  for (const symbol of SYMBOLS) {
    const position = book.positions[symbol];
    if (position.qty === 0) continue;
    const mark = marks[symbol] ?? position.avgPrice;
    pnl += position.qty * (mark - position.avgPrice);
  }
  return pnl;
}

export function grossNotional(book: Book, marks: Partial<Record<Symbol, number>>): number {
  let gross = 0;
  for (const symbol of SYMBOLS) {
    const position = book.positions[symbol];
    const mark = marks[symbol] ?? position.avgPrice;
    gross += Math.abs(position.qty * mark);
  }
  return gross;
}

export function fitNotional(
  book: Book,
  order: { type: "buy" | "sell"; symbol: Symbol; notionalUsd: number; price: number },
  caps: PaperCaps,
  marks: Partial<Record<Symbol, number>>,
): FitNotional {
  if (!(order.price > 0) || !Number.isFinite(order.price)) {
    return { type: "rejected", reason: "price unavailable" };
  }

  const requested = Math.max(order.notionalUsd, 0);
  let notional = Math.min(requested, caps.maxTradeNotionalUsd);
  const binds: ExposureBind[] = [];
  if (requested > caps.maxTradeNotionalUsd + 1e-9) binds.push("max-trade");
  if (notional < MIN_NOTIONAL_USD) {
    return { type: "rejected", reason: "notional below minimum" };
  }

  const position = book.positions[order.symbol];
  const price = order.price;
  const sign = order.type === "buy" ? 1 : -1;
  const desiredQty = position.qty + sign * (notional / price);
  const fitted = fitExposure(book, order.symbol, position.qty, desiredQty, price, caps, marks);
  if (fitted.type === "rejected") {
    return { type: "rejected", reason: fitted.reason };
  }

  let delta = fitted.nextQty - position.qty;
  if (fitted.clipped) binds.push(fitted.clipped);
  notional = Math.abs(delta) * price;
  if (delta > 0 && notional > book.cashUsd + 1e-9) {
    if (book.cashUsd < MIN_NOTIONAL_USD) {
      return { type: "rejected", reason: "cash insufficient" };
    }
    delta = book.cashUsd / price;
    notional = delta * price;
    binds.push("cash");
  }
  if (notional < MIN_NOTIONAL_USD || Math.sign(delta) !== sign) {
    return { type: "rejected", reason: "notional below minimum" };
  }
  return { type: "ok", notionalUsd: notional, deltaQty: delta, binds };
}

export function applyOrder(
  book: Book,
  order: PaperOrder,
  caps: PaperCaps,
  gate: RiskGate,
  marks: Partial<Record<Symbol, number>>,
): ApplyResult {
  if (gate.type === "frozen") {
    return { type: "rejected", book, reason: gate.reason };
  }

  const fitted = fitNotional(book, order, caps, marks);
  if (fitted.type === "rejected") {
    return { type: "rejected", book, reason: fitted.reason };
  }

  const price = order.price;
  const position = book.positions[order.symbol];
  const delta = fitted.deltaQty;
  const notional = fitted.notionalUsd;
  const qty = Math.abs(delta);
  const combined = combinePosition(position, delta, price);
  const fill: PaperFill = {
    type: order.type,
    symbol: order.symbol,
    price,
    qty,
    notionalUsd: notional,
    realizedPnlUsd: combined.realized,
    time: order.time,
    judgmentId: order.judgmentId,
  };
  const next: Book = {
    startingCashUsd: book.startingCashUsd,
    cashUsd: book.cashUsd - delta * price,
    realizedPnlUsd: book.realizedPnlUsd + combined.realized,
    tradeCount: book.tradeCount + 1,
    positions: { ...book.positions, [order.symbol]: combined.position },
    fills: [fill, ...book.fills].slice(0, 40),
  };
  return { type: "filled", book: next, fill };
}

function fitExposure(
  book: Book,
  symbol: Symbol,
  oldQty: number,
  desiredQty: number,
  price: number,
  caps: PaperCaps,
  marks: Partial<Record<Symbol, number>>,
): { type: "ok"; nextQty: number; clipped: "symbol" | "gross" | null } | { type: "rejected"; reason: string } {
  if (Math.abs(desiredQty) <= Math.abs(oldQty) + 1e-12) {
    return { type: "ok", nextQty: desiredQty, clipped: null };
  }

  const symbolMaxAbsQty = caps.maxSymbolNotionalUsd / price;
  const otherGross = grossExcluding(book, symbol, marks);
  const grossMaxAbsQty = Math.max(0, caps.maxGrossNotionalUsd - otherGross) / price;
  const maxAbsQty = Math.min(symbolMaxAbsQty, grossMaxAbsQty);
  if (Math.abs(desiredQty) <= maxAbsQty + 1e-9) {
    return { type: "ok", nextQty: desiredQty, clipped: null };
  }

  const nextQty = Math.sign(desiredQty) * maxAbsQty;
  const towardTrade = (nextQty - oldQty) * Math.sign(desiredQty - oldQty) > 0;
  if (!towardTrade || Math.abs(nextQty - oldQty) * price < MIN_NOTIONAL_USD) {
    const reason = symbolMaxAbsQty <= grossMaxAbsQty ? "symbol notional cap" : "gross notional cap";
    return { type: "rejected", reason };
  }
  const clipped = symbolMaxAbsQty <= grossMaxAbsQty ? "symbol" : "gross";
  return { type: "ok", nextQty, clipped };
}

function grossExcluding(
  book: Book,
  symbol: Symbol,
  marks: Partial<Record<Symbol, number>>,
): number {
  let gross = 0;
  for (const name of SYMBOLS) {
    if (name === symbol) continue;
    const position = book.positions[name];
    const mark = marks[name] ?? position.avgPrice;
    gross += Math.abs(position.qty * mark);
  }
  return gross;
}

function combinePosition(
  position: Position,
  deltaQty: number,
  price: number,
): { position: Position; realized: number } {
  if (Math.abs(position.qty) < 1e-12) {
    return { position: { qty: deltaQty, avgPrice: price }, realized: 0 };
  }
  const sameDirection = Math.sign(position.qty) === Math.sign(deltaQty);
  if (sameDirection) {
    const qty = position.qty + deltaQty;
    const avgPrice =
      (Math.abs(position.qty) * position.avgPrice + Math.abs(deltaQty) * price) / Math.abs(qty);
    return { position: { qty, avgPrice }, realized: 0 };
  }

  const closeQty = Math.min(Math.abs(position.qty), Math.abs(deltaQty));
  const realized = closeQty * (price - position.avgPrice) * Math.sign(position.qty);
  const remaining = position.qty + deltaQty;
  if (Math.abs(remaining) < 1e-10) {
    return { position: { qty: 0, avgPrice: 0 }, realized };
  }
  if (Math.sign(remaining) === Math.sign(position.qty)) {
    return { position: { qty: remaining, avgPrice: position.avgPrice }, realized };
  }
  return { position: { qty: remaining, avgPrice: price }, realized };
}

function emptyPositions(): Record<Symbol, Position> {
  return {
    BTCUSDT: { qty: 0, avgPrice: 0 },
    ETHUSDT: { qty: 0, avgPrice: 0 },
    SOLUSDT: { qty: 0, avgPrice: 0 },
  };
}
