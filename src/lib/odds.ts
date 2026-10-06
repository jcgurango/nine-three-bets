import type { Pick } from "./types";

/** How much of the price comes from the admin-provided odds vs. what users have bet. */
export const PROVIDED_WEIGHT = 0.5;
/**
 * Virtual credits seeded into each pool at the provided odds, so the first few
 * bets nudge the price instead of swinging the user-driven half to 100%.
 */
export const POOL_SEED = 50_000;
const MIN_PROB = 0.02;
const MAX_PROB = 0.98;

export interface MarketPricing {
  oddsA: number | null;
  oddsB: number | null;
  stakeA: number;
  stakeB: number;
}

export interface Quote {
  /** Decimal odds, 2dp. */
  odds: number;
  payout: number;
  /** Blended probability of the picked side. */
  prob: number;
}

/** Provided decimal odds -> probability of A, with the bookmaker margin normalized out. */
export function providedProbA(m: MarketPricing): number | null {
  if (!m.oddsA || !m.oddsB || m.oddsA <= 1 || m.oddsB <= 1) return null;
  const ia = 1 / m.oddsA;
  const ib = 1 / m.oddsB;
  return ia / (ia + ib);
}

export function blendedProbA(providedA: number, stakeA: number, stakeB: number): number {
  const poolA = (stakeA + POOL_SEED * providedA) / (stakeA + stakeB + POOL_SEED);
  return PROVIDED_WEIGHT * providedA + (1 - PROVIDED_WEIGHT) * poolA;
}

/**
 * Price a bet of `stake` on `pick`. The bet is priced at the odds *after* its
 * own stake is added to the pool, so moving the line with your own bets and
 * then taking the other side is never risk-free. `stake = 0` gives the
 * displayed (marginal) odds.
 */
export function quote(m: MarketPricing, pick: Pick, stake = 0): Quote | null {
  const providedA = providedProbA(m);
  if (providedA == null) return null;
  const probA = blendedProbA(
    providedA,
    m.stakeA + (pick === "a" ? stake : 0),
    m.stakeB + (pick === "b" ? stake : 0),
  );
  const prob = Math.min(MAX_PROB, Math.max(MIN_PROB, pick === "a" ? probA : 1 - probA));
  const oddsCents = Math.max(101, Math.floor(100 / prob));
  return { odds: oddsCents / 100, payout: Math.floor((stake * oddsCents) / 100), prob };
}
