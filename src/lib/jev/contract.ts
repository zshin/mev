import { z } from "zod";

import { SYMBOLS } from "@/lib/market/types";

/** Alias sent on the wire. The response `model` is the version that answered. */
export const JEV_MODEL = "jev-latest" as const;

export const TAPE_QUESTION = "tape";

export const JUDGE_ACTIONS = ["act_buy", "act_sell", "wait", "escalate"] as const;

export type JudgeActionName = (typeof JUDGE_ACTIONS)[number];

export const CLOSED_REASONS = [
  "missing-key",
  "timeout",
  "unauthorized",
  "rate-limited",
  "unavailable",
  "malformed",
  "rejected",
] as const;

export type ClosedReason = (typeof CLOSED_REASONS)[number];

export const TAPE_INSTRUCTIONS =
  "Short-horizon tape-alignment desk. The state is the only market. Prefer act_buy or act_sell to follow when regime is trend and momentumBps and imbalance share a sign. Prefer wait when regime is chop. Prefer escalate when the shock is large or momentum and taker imbalance disagree. Never invent a fill, a price, or a size. wait takes no new risk. escalate is ambiguity only and does not fill.";

export const TAPE_CRITERIA = {
  act_buy: "Open or add long paper risk, or cover a short when inventory is negative.",
  act_sell: "Open or add short paper risk, or reduce a long when inventory is positive.",
  wait: "No new risk. Chop, noise, or tape that does not agree.",
  escalate: "Ambiguity only. Shock or disagreement. Never a fill.",
} as const;

const unit = z.number().finite().min(0).max(1);
const money = z.number().finite();

export const optionScoresSchema = z
  .object({
    act_buy: unit,
    act_sell: unit,
    wait: unit,
    escalate: unit,
  })
  .strict();

export type OptionScoreMap = z.infer<typeof optionScoresSchema>;

export const deskStateSchema = z
  .object({
    symbol: z.enum(SYMBOLS),
    lastPrice: z.number().finite().positive(),
    momentumBps: z.number().finite(),
    imbalance: z.number().finite().min(-1).max(1),
    volatilityBps: z.number().finite().nonnegative(),
    shockBps: z.number().finite(),
    regime: z.enum(["trend", "chop"]),
    inventory: z.number().finite().min(-1).max(1),
    cooldownMs: z.number().finite().nonnegative(),
    cashRoomUsd: money.nonnegative(),
    capsRemaining: z
      .object({
        symbolLongUsd: money.nonnegative(),
        symbolShortUsd: money.nonnegative(),
        grossUsd: money.nonnegative(),
        maxTradeUsd: money.nonnegative(),
      })
      .strict(),
  })
  .strict();

export type DeskState = z.infer<typeof deskStateSchema>;

export const choiceResultSchema = z
  .object({
    type: z.literal("choice"),
    model: z.string().min(1).max(64),
    latencyMs: z.number().finite().nonnegative(),
    action: z.enum(JUDGE_ACTIONS),
    probability: unit,
    confidence: unit.nullable(),
    optionScores: optionScoresSchema,
  })
  .strict();

export const closedResultSchema = z
  .object({
    type: z.literal("closed"),
    reason: z.enum(CLOSED_REASONS),
    latencyMs: z.number().finite().nonnegative(),
    retryAfterMs: z.number().finite().nonnegative().nullable(),
  })
  .strict();

export const hostResultSchema = z.discriminatedUnion("type", [choiceResultSchema, closedResultSchema]);

export type ChoiceResult = z.infer<typeof choiceResultSchema>;
export type ClosedResult = z.infer<typeof closedResultSchema>;
export type HostResult = z.infer<typeof hostResultSchema>;

export const jevHealthSchema = z
  .object({
    configured: z.boolean(),
    model: z.literal(JEV_MODEL),
  })
  .strict();

export type JevHealth = z.infer<typeof jevHealthSchema>;

export function closedReasonCopy(reason: ClosedReason): string {
  switch (reason) {
    case "missing-key":
      return "API key not configured";
    case "timeout":
      return "Jev timed out";
    case "unauthorized":
      return "Jev rejected the key";
    case "rate-limited":
      return "Jev rate limited";
    case "unavailable":
      return "Jev unavailable";
    case "malformed":
      return "Jev response malformed";
    case "rejected":
      return "Jev rejected the question";
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

export function closedResult(reason: ClosedReason, latencyMs: number, retryAfterMs: number | null = null): ClosedResult {
  return { type: "closed", reason, latencyMs, retryAfterMs };
}
