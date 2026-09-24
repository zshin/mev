import type { Regime } from "@/lib/jev/surface";

/** Do not start another live call inside this gap, even if the tape moved. */
export const LIVE_MIN_GAP_MS = 800;

/** Ask again on a quiet tape so an armed desk does not go stale. */
export const LIVE_HEARTBEAT_MS = 2_500;

const MOMENTUM_MOVE_BPS = 1;
const IMBALANCE_MOVE = 0.15;
const SHOCK_LINE_BPS = 1.8;
const SIGN_FLIP_BPS = 1.15;

export type TapeSignature = {
  regime: Regime;
  momentumBps: number;
  imbalance: number;
  shockBps: number;
};

export function tapeMeaningfullyChanged(previous: TapeSignature | null, next: TapeSignature): boolean {
  if (!previous) return true;
  if (previous.regime !== next.regime) return true;
  if (
    Math.sign(previous.momentumBps) !== Math.sign(next.momentumBps) &&
    Math.abs(next.momentumBps) >= SIGN_FLIP_BPS
  ) {
    return true;
  }
  if (Math.abs(next.momentumBps - previous.momentumBps) >= MOMENTUM_MOVE_BPS) return true;
  if (Math.abs(next.imbalance - previous.imbalance) >= IMBALANCE_MOVE) return true;
  const previousShock = Math.abs(previous.shockBps) >= SHOCK_LINE_BPS;
  const nextShock = Math.abs(next.shockBps) >= SHOCK_LINE_BPS;
  return previousShock !== nextShock;
}

export function liveCallDue(input: {
  now: number;
  lastCallAt: number;
  notBefore: number;
  inFlight: boolean;
  previous: TapeSignature | null;
  next: TapeSignature;
}): boolean {
  if (input.inFlight) return false;
  if (input.now < input.notBefore) return false;
  if (input.lastCallAt === 0) return true;
  const elapsed = input.now - input.lastCallAt;
  if (elapsed >= LIVE_HEARTBEAT_MS) return true;
  if (elapsed < LIVE_MIN_GAP_MS) return false;
  return tapeMeaningfullyChanged(input.previous, input.next);
}
