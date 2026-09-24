import { SHOCK_WINDOW_MS, type ShockSource } from "@/lib/jev/tape";
import type { PaperCaps } from "@/lib/paper/book";

export const STRATEGY_NAME = "Tape Alignment Surface";

/**
 * Tape Alignment Surface.
 *
 * The desk does not predict the next tick. Every cycle it scores four exclusive
 * options, turns those scores into probabilities, then lets hard gates override.
 *
 * Regime
 *   trend when both halves of the window share a sign, each moved at least
 *   `trendHalfBps`, and range is below `trendMaxVolBps`. Otherwise chop.
 *
 * Logits (higher wins, before the gate)
 *   trend + aligned taker, vol still clean:
 *     follow = 1.55 + 0.85 * strength * (0.45 + 0.55 * pressure)
 *     the agreeing side gets `follow`; wait gets +0.15
 *   trend but taker does not confirm:
 *     wait += 0.45; the momentum side gets 0.25 * strength
 *   chop:
 *     wait += 0.85
 *     a damped chase (0.35 * strength * pressure) only if aligned and vol < 3.2
 *   inventory tilts against adding: buy -= 0.7 * longRatio, sell -= 0.7 * shortRatio
 *     where ratio = positionNotional / symbol cap, clamped to [-1.5, 1.5]
 *   strength = clamp(|momentum| / 4.5, 0, 1.5)
 *   pressure = clamp(|imbalance|, 0, 1)
 *
 * Escalate kicks, added on top of a 0.15 base. Any one of them clears a chop
 * wait (about 1.75) without firing on a quiet print:
 *   shock  (|shock| >= shockBps):  +2.15 + 0.35 * max(0, |shock|/shockBps - 1)
 *   fight  (momentum and taker oppose, both past their floors): +1.85
 *   whipsaw (chop, halves oppose, each past whipsawHalfBps): +1.85
 *   wide   (chop and vol >= wideVolBps): +1.9 + 0.2 * volStress
 *   otherwise shock only adds 0.12 * |shock|/shockBps
 *   volStress = clamp((vol - 1.2) / 4, 0, 1.5)
 *   quiet tape (inside noise, no kick): wait += 0.55
 *
 * Probability is the softmax of the gated logits. `optionScores` on the
 * judgment are those four probabilities (they sum to 1), not the raw logits.
 * Hard gates floor an illegal act to -8 before that softmax, so the mass
 * moves to wait or escalate:
 *   Jev off, cooldown, symbol cap, gross cap, cash under `minRoomUsd`.
 * Escalate never clears a gate into a fill. The store only sends act_buy and
 * act_sell to the paper book.
 */
export const THRESHOLDS = {
  warmupPrints: 12,
  minSpanMs: 1_500,
  shockWindowMs: SHOCK_WINDOW_MS,
  noiseMomentumBps: 1.15,
  alignImbalance: 0.12,
  trendHalfBps: 0.7,
  trendMaxVolBps: 4,
  chopChaseMaxVolBps: 3.2,
  actCooldownMs: 2_500,
  minRoomUsd: 5,
  shockBps: 1.8,
  wideVolBps: 4.5,
  disagreeMomentumBps: 1.5,
  disagreeImbalance: 0.28,
  whipsawHalfBps: 0.9,
} as const;

const LOGIT_FLOOR = -8;
const READY_COOLDOWN_MS = 60_000;

export type JudgeAction = "act_buy" | "act_sell" | "wait" | "escalate";

export type Regime = "trend" | "chop";

export type OptionScores = Record<JudgeAction, number>;

export type SurfaceFeatures = {
  momentumBps: number;
  imbalance: number;
  volatilityBps: number;
  shockBps: number;
  inventory: number;
  cooldown: number;
};

export type JudgeInput = {
  sampleCount: number;
  spanMs: number;
  momentumBps: number;
  imbalance: number;
  volatilityBps: number;
  shockBps: number;
  shockSource: ShockSource;
  earlyMomentumBps: number;
  lateMomentumBps: number;
  positionNotionalUsd: number;
  grossNotionalUsd: number;
  cashUsd: number;
  msSinceLastAct: number;
  jevEnabled: boolean;
  caps: Pick<PaperCaps, "maxTradeNotionalUsd" | "maxSymbolNotionalUsd" | "maxGrossNotionalUsd">;
};

export type Judgment = {
  action: JudgeAction;
  probability: number;
  reason: string;
  regime: Regime;
  features: SurfaceFeatures;
  optionScores: OptionScores;
  drivers: string[];
};

type Logits = OptionScores;

type SurfaceRead = {
  regime: Regime;
  aligned: boolean;
  fight: boolean;
  whipsaw: boolean;
  wide: boolean;
  shock: boolean;
  noise: boolean;
};

const ACTIONS = ["act_buy", "act_sell", "wait", "escalate"] as const;

export function classifyRegime(earlyMomentumBps: number, lateMomentumBps: number, volatilityBps: number): Regime {
  const sameDirection = Math.sign(earlyMomentumBps) !== 0 && Math.sign(earlyMomentumBps) === Math.sign(lateMomentumBps);
  const persistent =
    sameDirection &&
    Math.abs(earlyMomentumBps) >= THRESHOLDS.trendHalfBps &&
    Math.abs(lateMomentumBps) >= THRESHOLDS.trendHalfBps;
  if (persistent && volatilityBps < THRESHOLDS.trendMaxVolBps) return "trend";
  return "chop";
}

export function opensRisk(action: JudgeAction): boolean {
  switch (action) {
    case "act_buy":
    case "act_sell":
      return true;
    case "wait":
    case "escalate":
      return false;
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

export function judgeTick(input: JudgeInput): Judgment {
  const read = readSurface(input);
  const features = featuresOf(input);
  if (input.sampleCount < THRESHOLDS.warmupPrints) {
    return hold(read.regime, features, [`warmup · ${input.sampleCount} prints`, "inside the noise"]);
  }
  if (input.spanMs < THRESHOLDS.minSpanMs) {
    return hold(read.regime, features, ["window still opening", "inside the noise"]);
  }

  const raw = logits(input, read);
  const gated = applyGates(raw, input);
  const optionScores = softmax(gated.logits);
  const action = argmax(optionScores);
  const drivers = buildDrivers(input, read, action, gated.gateDrivers, argmax(raw));
  return {
    action,
    probability: optionScores[action],
    reason: drivers.join(" · "),
    regime: read.regime,
    features,
    optionScores,
    drivers,
  };
}

function hold(regime: Regime, features: SurfaceFeatures, drivers: string[]): Judgment {
  const optionScores: OptionScores = { act_buy: 0.04, act_sell: 0.04, wait: 0.86, escalate: 0.06 };
  return {
    action: "wait",
    probability: optionScores.wait,
    reason: drivers.join(" · "),
    regime,
    features,
    optionScores,
    drivers,
  };
}

function readSurface(input: JudgeInput): SurfaceRead {
  const regime = classifyRegime(input.earlyMomentumBps, input.lateMomentumBps, input.volatilityBps);
  const momentumAbs = Math.abs(input.momentumBps);
  const imbalanceAbs = Math.abs(input.imbalance);
  const shockAbs = Math.abs(input.shockBps);
  const momentumSign = Math.sign(input.momentumBps);
  const imbalanceSign = Math.sign(input.imbalance);
  const aligned =
    momentumSign !== 0 &&
    momentumSign === imbalanceSign &&
    momentumAbs >= THRESHOLDS.noiseMomentumBps &&
    imbalanceAbs >= THRESHOLDS.alignImbalance;
  const fight =
    momentumSign !== 0 &&
    imbalanceSign !== 0 &&
    momentumSign !== imbalanceSign &&
    momentumAbs >= THRESHOLDS.disagreeMomentumBps &&
    imbalanceAbs >= THRESHOLDS.disagreeImbalance;
  const earlySign = Math.sign(input.earlyMomentumBps);
  const whipsaw =
    earlySign !== 0 &&
    earlySign !== Math.sign(input.lateMomentumBps) &&
    Math.abs(input.earlyMomentumBps) >= THRESHOLDS.whipsawHalfBps &&
    Math.abs(input.lateMomentumBps) >= THRESHOLDS.whipsawHalfBps;
  const wide = regime === "chop" && input.volatilityBps >= THRESHOLDS.wideVolBps;
  const shock = shockAbs >= THRESHOLDS.shockBps;
  const noise = momentumAbs < THRESHOLDS.noiseMomentumBps && !shock && !fight && !whipsaw && !wide;
  return { regime, aligned, fight, whipsaw, wide, shock, noise };
}

function logits(input: JudgeInput, read: SurfaceRead): Logits {
  const momentum = input.momentumBps;
  const imbalance = input.imbalance;
  const strength = clamp(Math.abs(momentum) / 4.5, 0, 1.5);
  const pressure = clamp(Math.abs(imbalance), 0, 1);
  const volStress = clamp((input.volatilityBps - 1.2) / 4, 0, 1.5);
  const shockStress = clamp(Math.abs(input.shockBps) / THRESHOLDS.shockBps, 0, 2.2);
  const inventory = clamp(inventoryRatio(input), -1.5, 1.5);
  const longTilt = Math.max(0, inventory);
  const shortTilt = Math.max(0, -inventory);

  let buy = 0.05;
  let sell = 0.05;
  let wait = 0.9;
  let escalate = 0.15;

  if (read.regime === "trend" && read.aligned && input.volatilityBps < THRESHOLDS.trendMaxVolBps) {
    const follow = 1.55 + 0.85 * strength * (0.45 + 0.55 * pressure);
    if (momentum > 0) buy += follow;
    else sell += follow;
    wait += 0.15;
  } else if (read.regime === "trend") {
    wait += 0.45;
    if (momentum > 0) buy += 0.25 * strength;
    else if (momentum < 0) sell += 0.25 * strength;
  } else {
    wait += 0.85;
    if (read.aligned && input.volatilityBps < THRESHOLDS.chopChaseMaxVolBps) {
      const chase = 0.35 * strength * pressure;
      if (momentum > 0) buy += chase;
      else sell += chase;
    }
  }

  buy -= 0.7 * longTilt;
  sell -= 0.7 * shortTilt;

  if (read.shock) escalate += 2.15 + 0.35 * Math.max(0, shockStress - 1);
  else escalate += 0.12 * shockStress;
  if (read.fight) escalate += 1.85;
  if (read.whipsaw) escalate += 1.85;
  if (read.wide) escalate += 1.9 + 0.2 * volStress;
  if (read.noise) wait += 0.55;

  return { act_buy: buy, act_sell: sell, wait, escalate };
}

function applyGates(raw: Logits, input: JudgeInput): { logits: Logits; gateDrivers: string[] } {
  const next: Logits = { ...raw };
  const drivers: string[] = [];
  const preferred = argmax(raw);

  if (!input.jevEnabled) {
    next.act_buy = LOGIT_FLOOR;
    next.act_sell = LOGIT_FLOOR;
    if (preferred === "act_buy" || preferred === "act_sell") drivers.push("Jev is off");
    return { logits: next, gateDrivers: drivers };
  }

  if (input.msSinceLastAct < THRESHOLDS.actCooldownMs) {
    next.act_buy = LOGIT_FLOOR;
    next.act_sell = LOGIT_FLOOR;
    if (preferred === "act_buy" || preferred === "act_sell") {
      const remain = (THRESHOLDS.actCooldownMs - input.msSinceLastAct) / 1000;
      drivers.push(`cooldown ${remain.toFixed(1)}s`);
    }
    return { logits: next, gateDrivers: drivers };
  }

  const buyBlock = blockReason(input, "buy");
  const sellBlock = blockReason(input, "sell");
  if (buyBlock) {
    next.act_buy = LOGIT_FLOOR;
    if (preferred === "act_buy") drivers.push(buyBlock);
  }
  if (sellBlock) {
    next.act_sell = LOGIT_FLOOR;
    if (preferred === "act_sell") drivers.push(sellBlock);
  }
  return { logits: next, gateDrivers: drivers };
}

function blockReason(input: JudgeInput, side: "buy" | "sell"): string | null {
  const exposure = exposureRoom(input, side);
  if (exposure.room < THRESHOLDS.minRoomUsd) return exposure.reason;
  if (side === "buy" && input.cashUsd < THRESHOLDS.minRoomUsd) return "cash insufficient";
  return null;
}

function exposureRoom(
  input: JudgeInput,
  side: "buy" | "sell",
): { room: number; reason: "symbol cap binds" | "gross cap binds" } {
  const position = input.positionNotionalUsd;
  const symbolRoom = side === "buy" ? input.caps.maxSymbolNotionalUsd - position : input.caps.maxSymbolNotionalUsd + position;
  const increasing = side === "buy" ? position >= -1e-6 : position <= 1e-6;
  if (!increasing) return { room: symbolRoom, reason: "symbol cap binds" };
  const grossRoom = input.caps.maxGrossNotionalUsd - input.grossNotionalUsd;
  if (grossRoom < symbolRoom) return { room: grossRoom, reason: "gross cap binds" };
  return { room: symbolRoom, reason: "symbol cap binds" };
}

function buildDrivers(
  input: JudgeInput,
  read: SurfaceRead,
  action: JudgeAction,
  gateDrivers: string[],
  leaned: JudgeAction,
): string[] {
  const drivers = [...gateDrivers, regimeLine(read), detailLine(input, read, action, gateDrivers, leaned)];
  if (action === "escalate") drivers.push("stub only");
  const filled = drivers.filter((driver) => driver.length > 0);
  if (filled.length < 2) filled.push(`vol ${input.volatilityBps.toFixed(1)} bps`);
  return filled.slice(0, 4);
}

function regimeLine(read: SurfaceRead): string {
  if (read.regime === "trend" && read.aligned) return "trend + aligned taker";
  if (read.regime === "trend") return "trend, taker does not confirm";
  return "chop, do not chase";
}

function detailLine(
  input: JudgeInput,
  read: SurfaceRead,
  action: JudgeAction,
  gateDrivers: string[],
  leaned: JudgeAction,
): string {
  if (action === "wait" && gateDrivers.length > 0 && (leaned === "act_buy" || leaned === "act_sell")) {
    return leaned === "act_buy" ? "surface leaned buy" : "surface leaned sell";
  }
  switch (action) {
    case "escalate":
      if (read.shock) return `shock ${signed(input.shockBps)}`;
      if (read.fight) return "momentum and taker disagree";
      if (read.whipsaw) return `window reversed ${signed(input.earlyMomentumBps)} / ${signed(input.lateMomentumBps)}`;
      if (read.wide) return `range ${input.volatilityBps.toFixed(1)} bps`;
      return "unclear tape";
    case "act_buy":
      return `buy ${signed(input.momentumBps)}, taker ${input.imbalance.toFixed(2)}`;
    case "act_sell":
      return `sell ${signed(input.momentumBps)}, taker ${input.imbalance.toFixed(2)}`;
    case "wait":
      return read.noise ? "inside the noise" : `${signed(input.momentumBps)} without a clean follow`;
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

function featuresOf(input: JudgeInput): SurfaceFeatures {
  return {
    momentumBps: input.momentumBps,
    imbalance: input.imbalance,
    volatilityBps: input.volatilityBps,
    shockBps: input.shockBps,
    inventory: inventoryRatio(input),
    cooldown: cooldownFeature(input.msSinceLastAct),
  };
}

function inventoryRatio(input: JudgeInput): number {
  const cap = input.caps.maxSymbolNotionalUsd;
  if (!(cap > 0)) return 0;
  return input.positionNotionalUsd / cap;
}

function cooldownFeature(msSinceLastAct: number): number {
  if (!Number.isFinite(msSinceLastAct) || msSinceLastAct >= READY_COOLDOWN_MS) return READY_COOLDOWN_MS;
  return Math.max(0, msSinceLastAct);
}

function softmax(logits: Logits): OptionScores {
  let maxLogit = Number.NEGATIVE_INFINITY;
  for (const action of ACTIONS) maxLogit = Math.max(maxLogit, logits[action]);
  const weights: number[] = [];
  let sum = 0;
  for (const action of ACTIONS) {
    const weight = Math.exp(logits[action] - maxLogit);
    weights.push(weight);
    sum += weight;
  }
  const scores = emptyScores();
  ACTIONS.forEach((action, index) => {
    scores[action] = (weights[index] ?? 0) / (sum || 1);
  });
  return roundScores(scores);
}

function roundScores(scores: OptionScores): OptionScores {
  const rounded = emptyScores();
  let top: JudgeAction = "wait";
  for (const action of ACTIONS) {
    rounded[action] = Math.round(scores[action] * 1000) / 1000;
    if (scores[action] > scores[top]) top = action;
  }
  let drift = 1;
  for (const action of ACTIONS) drift -= rounded[action];
  drift = Math.round(drift * 1000) / 1000;
  rounded[top] = Math.round((rounded[top] + drift) * 1000) / 1000;
  return rounded;
}

function argmax(scores: OptionScores): JudgeAction {
  let best: JudgeAction = "wait";
  for (const action of ["escalate", "act_buy", "act_sell"] as const) {
    if (scores[action] > scores[best]) best = action;
  }
  return best;
}

function emptyScores(): OptionScores {
  return { act_buy: 0, act_sell: 0, wait: 0, escalate: 0 };
}

function signed(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} bps`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
