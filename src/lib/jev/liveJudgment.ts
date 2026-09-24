import { closedReasonCopy, type ChoiceResult, type ClosedReason } from "@/lib/jev/contract";
import { THRESHOLDS, type Judgment, type Regime, type SurfaceFeatures } from "@/lib/jev/surface";

export function choiceJudgment(input: {
  choice: ChoiceResult;
  features: SurfaceFeatures;
  regime: Regime;
}): Judgment {
  const action = input.choice.action;
  const drivers = liveDrivers({
    failure: null,
    regime: input.regime,
    momentumBps: input.features.momentumBps,
    imbalance: input.features.imbalance,
    action,
  });
  return {
    action,
    probability: input.choice.optionScores[action],
    reason: drivers.join(" · "),
    regime: input.regime,
    features: input.features,
    optionScores: input.choice.optionScores,
    drivers,
    origin: "live",
    model: input.choice.model,
    latencyMs: input.choice.latencyMs,
    failure: null,
  };
}

export function closedJudgment(input: {
  reason: ClosedReason;
  latencyMs: number;
  features: SurfaceFeatures;
  regime: Regime;
}): Judgment {
  const failure = closedReasonCopy(input.reason);
  const drivers = liveDrivers({
    failure,
    regime: input.regime,
    momentumBps: input.features.momentumBps,
    imbalance: input.features.imbalance,
    action: "wait",
  });
  return {
    action: "wait",
    probability: 1,
    reason: drivers.join(" · "),
    regime: input.regime,
    features: input.features,
    optionScores: { act_buy: 0, act_sell: 0, wait: 1, escalate: 0 },
    drivers,
    origin: "live",
    model: null,
    latencyMs: input.latencyMs,
    failure,
  };
}

export function markTooSoft(judgment: Judgment): Judgment {
  const drivers = judgment.drivers.filter((driver) => driver !== "follow buy" && driver !== "follow sell");
  if (!drivers.includes("too soft")) drivers.push("too soft");
  const next = drivers.slice(0, 4);
  return {
    ...judgment,
    action: "wait",
    drivers: next,
    reason: next.join(" · "),
  };
}

function liveDrivers(input: {
  failure: string | null;
  regime: Regime;
  momentumBps: number;
  imbalance: number;
  action: Judgment["action"];
}): string[] {
  if (input.failure) return [input.failure, "fail closed"];
  const drivers = ["live Jev", regimePhrase(input.regime, input.momentumBps, input.imbalance)];
  switch (input.action) {
    case "act_buy":
      drivers.push("follow buy");
      break;
    case "act_sell":
      drivers.push("follow sell");
      break;
    case "wait":
      drivers.push("no new risk");
      break;
    case "escalate":
      drivers.push("stub only");
      break;
    default: {
      const unreachable: never = input.action;
      return [unreachable];
    }
  }
  return drivers;
}

function regimePhrase(regime: Regime, momentumBps: number, imbalance: number): string {
  if (regime === "chop") return "chop, prefer wait";
  const aligned =
    Math.sign(momentumBps) !== 0 &&
    Math.sign(momentumBps) === Math.sign(imbalance) &&
    Math.abs(momentumBps) >= THRESHOLDS.noiseMomentumBps &&
    Math.abs(imbalance) >= THRESHOLDS.alignImbalance;
  if (aligned) return "trend, taker agrees";
  return "trend, taker does not confirm";
}
