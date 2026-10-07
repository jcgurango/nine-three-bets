import type { Outcome } from "./types";

/**
 * How much of the price comes from the provided odds vs. what users have bet.
 * 1 means prices are the provided odds alone (margin removed) and user bets
 * don't move the line. Changing this only affects prices from now on: every
 * bet keeps the odds it was placed at.
 */
export const PROVIDED_WEIGHT = 1;
/**
 * Virtual credits seeded into each market at the provided odds, so the first
 * few bets nudge the price instead of swinging the user-driven half to 100%.
 * Only matters when PROVIDED_WEIGHT is below 1.
 */
export const POOL_SEED = 50_000;
const MIN_PROB = 0.02;
const MAX_PROB = 0.98;

export interface Quote {
  /** Decimal odds, 2dp. */
  odds: number;
  payout: number;
  /** Blended probability of the picked outcome. */
  prob: number;
}

/**
 * Provided decimal odds -> probability of each outcome, with the bookmaker
 * margin normalized out. Null if any outcome is missing odds.
 */
export function providedProbs(outcomes: Outcome[]): number[] | null {
  if (outcomes.length < 2 || outcomes.some((o) => !o.odds || o.odds <= 1)) return null;
  const implied = outcomes.map((o) => 1 / o.odds!);
  const total = implied.reduce((a, b) => a + b, 0);
  return implied.map((p) => p / total);
}

/**
 * Price a bet of `stake` on the outcome `pick`. The bet is priced at the odds
 * *after* its own stake is added to the pool, so moving the line with your own
 * bets and then taking the other outcomes is never risk-free. `stake = 0`
 * gives the displayed (marginal) odds.
 */
export function quote(outcomes: Outcome[], pick: string, stake = 0): Quote | null {
  const provided = providedProbs(outcomes);
  const index = outcomes.findIndex((o) => o.key === pick);
  if (!provided || index < 0) return null;
  const staked = outcomes.reduce((n, o) => n + o.stake, 0) + stake;
  const pool = (outcomes[index].stake + stake + POOL_SEED * provided[index]) / (staked + POOL_SEED);
  const blended = PROVIDED_WEIGHT * provided[index] + (1 - PROVIDED_WEIGHT) * pool;
  const prob = Math.min(MAX_PROB, Math.max(MIN_PROB, blended));
  const oddsCents = Math.max(101, Math.floor(100 / prob));
  return { odds: oddsCents / 100, payout: Math.floor((stake * oddsCents) / 100), prob };
}
