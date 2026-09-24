import type { PaperCaps } from "@/lib/paper/book";

export type JudgeAction = "act_buy" | "act_sell" | "wait" | "escalate";

export type Judgment = {
  action: JudgeAction;
  probability: number;
  reason: string;
};

export type JudgeInput = {
  sampleCount: number;
  momentumBps: number;
  imbalance: number;
  volatilityBps: number;
  lastMoveBps: number;
  positionNotionalUsd: number;
  cashUsd: number;
  msSinceLastAct: number;
  caps: Pick<PaperCaps, "maxTradeNotionalUsd" | "maxSymbolNotionalUsd">;
};

const WARMUP_TICKS = 12;
const ACT_MOMENTUM_BPS = 1.6;
const ACT_IMBALANCE = 0.1;
const ACT_MAX_VOL_BPS = 22;
const SHOCK_MOVE_BPS = 7;
const WIDE_VOL_BPS = 28;
const DISAGREE_MOMENTUM_BPS = 3.5;
const DISAGREE_IMBALANCE = 0.4;
const ACT_COOLDOWN_MS = 2500;
const MIN_ROOM_USD = 5;

type TapeRead =
  | { type: "warmup"; samples: number }
  | { type: "shock"; lastMoveBps: number }
  | { type: "wide"; volatilityBps: number }
  | { type: "disagree"; momentumBps: number; imbalance: number }
  | { type: "aligned"; side: "buy" | "sell"; momentumBps: number; imbalance: number }
  | { type: "quiet"; momentumBps: number };

export function judgeTick(input: JudgeInput): Judgment {
  const read = readTape(input);
  switch (read.type) {
    case "warmup":
      return {
        action: "wait",
        probability: probability(0.42),
        reason: `Warmup · ${read.samples} prints`,
      };
    case "shock":
      return {
        action: "escalate",
        probability: probability(0.8 + Math.min(Math.abs(read.lastMoveBps), 20) / 120),
        reason: `Shock ${signed(read.lastMoveBps)} on the last print — escalate stub`,
      };
    case "wide":
      return {
        action: "escalate",
        probability: probability(0.72 + Math.min(read.volatilityBps, 40) / 160),
        reason: `Range ${read.volatilityBps.toFixed(1)} bps — escalate stub`,
      };
    case "disagree":
      return {
        action: "escalate",
        probability: probability(0.68 + Math.abs(read.imbalance) * 0.2),
        reason: `Momentum ${signed(read.momentumBps)} vs taker ${read.imbalance.toFixed(2)} — escalate stub`,
      };
    case "aligned":
      return actOrHold(read, input);
    case "quiet":
      return {
        action: "wait",
        probability: probability(0.5 + (1 - Math.min(Math.abs(read.momentumBps), 1.6) / 3) * 0.12),
        reason: `Inside the noise · ${signed(read.momentumBps)}`,
      };
    default: {
      const unreachable: never = read;
      return unreachable;
    }
  }
}

function readTape(input: JudgeInput): TapeRead {
  if (input.sampleCount < WARMUP_TICKS) {
    return { type: "warmup", samples: input.sampleCount };
  }
  if (Math.abs(input.lastMoveBps) >= SHOCK_MOVE_BPS) {
    return { type: "shock", lastMoveBps: input.lastMoveBps };
  }
  if (input.volatilityBps >= WIDE_VOL_BPS) {
    return { type: "wide", volatilityBps: input.volatilityBps };
  }
  const momentumSign = Math.sign(input.momentumBps);
  const imbalanceSign = Math.sign(input.imbalance);
  const disagree =
    Math.abs(input.momentumBps) >= DISAGREE_MOMENTUM_BPS &&
    Math.abs(input.imbalance) >= DISAGREE_IMBALANCE &&
    momentumSign !== 0 &&
    imbalanceSign !== 0 &&
    momentumSign !== imbalanceSign;
  if (disagree) {
    return {
      type: "disagree",
      momentumBps: input.momentumBps,
      imbalance: input.imbalance,
    };
  }
  const aligned =
    Math.abs(input.momentumBps) >= ACT_MOMENTUM_BPS &&
    Math.abs(input.imbalance) >= ACT_IMBALANCE &&
    momentumSign !== 0 &&
    momentumSign === imbalanceSign &&
    input.volatilityBps < ACT_MAX_VOL_BPS;
  if (aligned) {
    return {
      type: "aligned",
      side: momentumSign > 0 ? "buy" : "sell",
      momentumBps: input.momentumBps,
      imbalance: input.imbalance,
    };
  }
  return { type: "quiet", momentumBps: input.momentumBps };
}

function actOrHold(read: Extract<TapeRead, { type: "aligned" }>, input: JudgeInput): Judgment {
  const confidence = probability(
    0.78 + Math.min(Math.abs(read.momentumBps), 12) / 60 + Math.abs(read.imbalance) * 0.08,
  );
  const sideLabel = read.side === "buy" ? "Buy" : "Sell";
  const detail = `${sideLabel} ${signed(read.momentumBps)}, taker ${read.imbalance.toFixed(2)}`;

  if (input.msSinceLastAct < ACT_COOLDOWN_MS) {
    const remain = ((ACT_COOLDOWN_MS - input.msSinceLastAct) / 1000).toFixed(1);
    return {
      action: "wait",
      probability: probability(0.64),
      reason: `${detail} · held ${remain}s`,
    };
  }

  const room = roomUsd(input.positionNotionalUsd, read.side, input.caps.maxSymbolNotionalUsd);
  if (room < MIN_ROOM_USD) {
    return {
      action: "wait",
      probability: probability(0.7),
      reason: `${detail} · symbol cap binds`,
    };
  }
  if (read.side === "buy" && input.cashUsd < MIN_ROOM_USD && input.positionNotionalUsd >= -MIN_ROOM_USD) {
    return {
      action: "wait",
      probability: probability(0.66),
      reason: `${detail} · cash insufficient`,
    };
  }

  return {
    action: read.side === "buy" ? "act_buy" : "act_sell",
    probability: confidence,
    reason: detail,
  };
}

function roomUsd(positionNotionalUsd: number, side: "buy" | "sell", maxSymbolNotionalUsd: number): number {
  if (side === "buy") return maxSymbolNotionalUsd - positionNotionalUsd;
  return maxSymbolNotionalUsd + positionNotionalUsd;
}

function signed(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} bps`;
}

function probability(value: number): number {
  const clamped = Math.min(0.99, Math.max(0.05, value));
  return Math.round(clamped * 1000) / 1000;
}
