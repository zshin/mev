import { deskStateSchema, type DeskState } from "@/lib/jev/contract";
import type { Symbol } from "@/lib/market/types";
import type { Regime, SurfaceFeatures } from "@/lib/jev/surface";

const COOLDOWN_CAP_MS = 60_000;

export function clampInventory(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

export function buildDeskState(input: {
  symbol: Symbol;
  lastPrice: number;
  regime: Regime;
  features: SurfaceFeatures;
  positionNotionalUsd: number;
  cashUsd: number;
  grossNotionalUsd: number;
  symbolCapUsd: number;
  grossCapUsd: number;
  maxTradeUsd: number;
}): DeskState | null {
  if (!(input.lastPrice > 0) || !Number.isFinite(input.lastPrice)) return null;
  const inventory = clampInventory(input.features.inventory);
  const position = finite(input.positionNotionalUsd);
  const state = {
    symbol: input.symbol,
    lastPrice: round(input.lastPrice, 2),
    momentumBps: round(input.features.momentumBps, 2),
    imbalance: round(clamp(input.features.imbalance, -1, 1), 4),
    volatilityBps: round(Math.max(0, input.features.volatilityBps), 2),
    shockBps: round(input.features.shockBps, 2),
    regime: input.regime,
    inventory: round(inventory, 4),
    cooldownMs: cooldownMs(input.features.cooldown),
    cashRoomUsd: round(Math.max(0, finite(input.cashUsd)), 2),
    capsRemaining: {
      symbolLongUsd: room(input.symbolCapUsd - position),
      symbolShortUsd: room(input.symbolCapUsd + position),
      grossUsd: room(input.grossCapUsd - finite(input.grossNotionalUsd)),
      maxTradeUsd: round(Math.max(0, finite(input.maxTradeUsd)), 2),
    },
  };
  const parsed = deskStateSchema.safeParse(state);
  return parsed.success ? parsed.data : null;
}

function cooldownMs(value: number): number {
  if (!Number.isFinite(value)) return COOLDOWN_CAP_MS;
  return Math.round(clamp(value, 0, COOLDOWN_CAP_MS));
}

function room(value: number): number {
  return round(Math.max(0, finite(value)), 2);
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
