import { KIND_LABEL, type MarketKind, type Side } from "./types";

/** The two outcomes of a "which team wins" market. */
export const TEAM_OUTCOMES = ["a", "b"];

/**
 * Every possible final map score for a series, from a clean sweep by team A
 * to a clean sweep by team B. Keys are "<A's maps>-<B's maps>", so best of 3
 * gives 2-0, 2-1, 1-2, 0-2.
 */
export function scoreOutcomes(bestOf: number): string[] {
  const toWin = Math.ceil(bestOf / 2);
  const keys: string[] = [];
  for (let lost = 0; lost < toWin; lost++) keys.push(`${toWin}-${lost}`);
  for (let lost = toWin - 1; lost >= 0; lost--) keys.push(`${lost}-${toWin}`);
  return keys;
}

/**
 * The markets on a whole match and their outcome keys. A best of 1 has none:
 * its match winner is just the map 1 winner.
 */
export function matchLevelMarkets(bestOf: number): [MarketKind, string[]][] {
  if (bestOf < 3) return [];
  return [
    ["match", TEAM_OUTCOMES],
    ["score", scoreOutcomes(bestOf)],
  ];
}

function parseScore(key: string): [number, number] | null {
  const m = /^(\d+)-(\d+)$/.exec(key);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** The team an outcome is a win for, used for colouring. */
export function outcomeSide(key: string): Side {
  const score = parseScore(key);
  if (score) return score[0] > score[1] ? "a" : "b";
  return key === "b" ? "b" : "a";
}

/** "Paper Rex" for a team outcome, or "Paper Rex 2:1" (winner first) for a score. */
export function outcomeLabel(key: string, teamA: string, teamB: string): string {
  const team = outcomeSide(key) === "a" ? teamA : teamB;
  const score = parseScore(key);
  return score ? `${team} ${Math.max(...score)}:${Math.min(...score)}` : team;
}

/** Where a market sits, e.g. "Map 1 (Ascent) · 1st pistol" or "Correct score". */
export function marketLabel(kind: MarketKind, mapNumber: number, mapName: string): string {
  if (mapNumber === 0) return KIND_LABEL[kind];
  return `Map ${mapNumber}${mapName ? ` (${mapName})` : ""} · ${KIND_LABEL[kind]}`;
}
