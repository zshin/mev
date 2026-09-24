import type { ExposureBind } from "@/lib/paper/book";
import { fitNotional, type Book, type PaperCaps } from "@/lib/paper/book";
import type { Symbol } from "@/lib/market/types";
import type { JudgeAction, JudgmentOrigin } from "@/lib/jev/surface";

export const SOFT_BELOW = 0.6;
export const MID_BELOW = 0.75;
export const HIGH_BELOW = 0.9;
export const SMALL_USD = 50;
export const MID_USD = 100;
export const LARGE_USD = 200;

export type SizeBucket = typeof SMALL_USD | typeof MID_USD | typeof LARGE_USD;

export type SizePlan =
  | { type: "skip" }
  | { type: "blocked"; reason: "too-soft"; line: string }
  | { type: "blocked"; reason: "cooldown"; line: string; detail: string }
  | { type: "blocked"; reason: "no-room"; line: string; detail: string }
  | { type: "order"; side: "buy" | "sell"; notionalUsd: number; line: string };

export function confidenceBucket(probability: number): SizeBucket | null {
  if (!(probability >= SOFT_BELOW)) return null;
  if (probability < MID_BELOW) return SMALL_USD;
  if (probability < HIGH_BELOW) return MID_USD;
  return LARGE_USD;
}

export function inventoryLean(inventory: number, action: JudgeAction): number {
  const clamped = clamp(inventory, -1, 1);
  const adding = (action === "act_buy" && clamped > 0) || (action === "act_sell" && clamped < 0);
  if (!adding) return 1;
  return 1 - 0.5 * Math.abs(clamped);
}

export function planSize(input: {
  origin: JudgmentOrigin;
  choice: JudgeAction;
  probability: number;
  book: Book;
  symbol: Symbol;
  price: number;
  caps: PaperCaps;
  marks: Partial<Record<Symbol, number>>;
  msSinceLastAct: number;
  cooldownMs: number;
}): SizePlan {
  switch (input.choice) {
    case "wait":
    case "escalate":
      return { type: "skip" };
    case "act_buy":
    case "act_sell":
      return planAct(input, input.choice);
    default: {
      const unreachable: never = input.choice;
      return unreachable;
    }
  }
}

function planAct(
  input: {
    origin: JudgmentOrigin;
    probability: number;
    book: Book;
    symbol: Symbol;
    price: number;
    caps: PaperCaps;
    marks: Partial<Record<Symbol, number>>;
    msSinceLastAct: number;
    cooldownMs: number;
  },
  side: "act_buy" | "act_sell",
): SizePlan {
  const orderSide = side === "act_buy" ? "buy" : "sell";
  const cooling = cooldownDetail(input.msSinceLastAct, input.cooldownMs);
  if (input.origin === "local") {
    if (cooling) return { type: "blocked", reason: "cooldown", detail: cooling, line: localParts(null, [cooling]) };
    return quote(input, orderSide, input.caps.maxTradeNotionalUsd, null, 1);
  }

  const bucket = confidenceBucket(input.probability);
  if (bucket === null) {
    return { type: "blocked", reason: "too-soft", line: `p=${input.probability.toFixed(2)} · too soft` };
  }

  const position = input.book.positions[input.symbol];
  const inventory = input.caps.maxSymbolNotionalUsd > 0 ? (position.qty * input.price) / input.caps.maxSymbolNotionalUsd : 0;
  const lean = inventoryLean(inventory, side);
  if (cooling) {
    return {
      type: "blocked",
      reason: "cooldown",
      detail: cooling,
      line: liveParts(null, input.probability, bucket, lean, [], cooling),
    };
  }

  const desired = roundCents(bucket * lean);
  return quote(input, orderSide, desired, { probability: input.probability, bucket, lean }, lean);
}

function cooldownDetail(msSinceLastAct: number, cooldownMs: number): string | null {
  if (!(msSinceLastAct < cooldownMs)) return null;
  const remain = (cooldownMs - msSinceLastAct) / 1000;
  return `cooldown ${remain.toFixed(1)}s`;
}

function quote(
  input: {
    origin: JudgmentOrigin;
    book: Book;
    symbol: Symbol;
    price: number;
    caps: PaperCaps;
    marks: Partial<Record<Symbol, number>>;
  },
  side: "buy" | "sell",
  desiredUsd: number,
  live: { probability: number; bucket: SizeBucket; lean: number } | null,
  lean: number,
): SizePlan {
  const fitted = fitNotional(
    input.book,
    { type: side, symbol: input.symbol, notionalUsd: desiredUsd, price: input.price },
    input.caps,
    input.marks,
  );
  if (fitted.type === "rejected") {
    const detail = roomWord(fitted.reason);
    const line = live
      ? liveParts(null, live.probability, live.bucket, lean, [], detail)
      : localParts(null, [detail]);
    return { type: "blocked", reason: "no-room", line, detail: fitted.reason };
  }

  const line = live
    ? liveParts(fitted.notionalUsd, live.probability, live.bucket, lean, fitted.binds, null)
    : localParts(fitted.notionalUsd, fitted.binds.map(bindCopy));
  return { type: "order", side, notionalUsd: fitted.notionalUsd, line };
}

function liveParts(
  notional: number | null,
  probability: number,
  bucket: SizeBucket,
  lean: number,
  binds: ExposureBind[],
  tail: string | null,
): string {
  const parts: string[] = [];
  if (notional !== null) parts.push(formatDollars(notional));
  parts.push(`p=${probability.toFixed(2)}`);
  parts.push(`${formatDollars(bucket)} bucket`);
  if (lean < 0.999) parts.push(`lean ×${lean.toFixed(2)}`);
  for (const bind of binds) parts.push(bindCopy(bind));
  if (tail) parts.push(tail);
  return parts.join(" · ");
}

function localParts(notional: number | null, notes: string[]): string {
  const parts: string[] = [];
  if (notional !== null) parts.push(formatDollars(notional));
  parts.push("local surface");
  for (const note of notes) parts.push(note);
  return parts.join(" · ");
}

function roomWord(reason: string): string {
  switch (reason) {
    case "symbol notional cap":
      return "symbol room";
    case "gross notional cap":
      return "gross room";
    case "cash insufficient":
      return "cash";
    case "notional below minimum":
      return "below minimum";
    case "price unavailable":
      return "price";
    default:
      return "blocked";
  }
}

function bindCopy(bind: ExposureBind): string {
  switch (bind) {
    case "max-trade":
      return "max trade";
    case "symbol":
      return "symbol room";
    case "gross":
      return "gross room";
    case "cash":
      return "cash";
    default: {
      const unreachable: never = bind;
      return unreachable;
    }
  }
}

function formatDollars(value: number): string {
  const rounded = roundCents(value);
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return `$${Math.round(rounded).toString()}`;
  return `$${rounded.toFixed(2)}`;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, value));
}
