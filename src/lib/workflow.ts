import { KIND_LABEL, type Market, type MarketKind, type Match } from "./types";

/**
 * The one thing an admin most likely needs to do next while a match is being
 * played, worked out from the markets' current states. Order of play:
 * open the first maps, then for each map close and settle the 1st pistol,
 * the 2nd pistol and the map winner, opening the decider map when it's
 * reached. Anything already done, voided or never opened is skipped, so a
 * match handled partly by hand still gets a sensible next step.
 */
export type QuickStep =
  | { type: "open"; maps: number[] }
  | { type: "close"; market: Market; label: string }
  | { type: "settle"; market: Market; label: string };

/** The order markets are played in within a map. */
const PLAY_ORDER: MarketKind[] = ["pistol1", "pistol2", "map"];

export interface SeriesState {
  wins: { a: number; b: number };
  toWin: number;
  decided: "a" | "b" | null;
}

export function seriesState(match: Match): SeriesState {
  const wins = { a: 0, b: 0 };
  for (const m of match.markets) {
    if (m.kind === "map" && m.status === "settled" && (m.result === "a" || m.result === "b")) wins[m.result]++;
  }
  const toWin = Math.ceil(match.bestOf / 2);
  return { wins, toWin, decided: wins.a >= toWin ? "a" : wins.b >= toWin ? "b" : null };
}

export function nextQuickStep(match: Match): QuickStep | null {
  if (match.finalizedAt != null || seriesState(match).decided) return null;
  const { toWin } = seriesState(match);
  const mapMarkets = (n: number) => match.markets.filter((m) => m.mapNumber === n);
  const untouched = (n: number) => mapMarkets(n).every((m) => m.status === "draft");

  // Nothing has been opened yet: open every map that is sure to be played.
  const firstMaps = Array.from({ length: toWin }, (_, i) => i + 1);
  if (firstMaps.every(untouched)) return { type: "open", maps: firstMaps };

  for (let n = 1; n <= match.bestOf; n++) {
    if (untouched(n)) return { type: "open", maps: [n] };
    for (const kind of PLAY_ORDER) {
      const market = mapMarkets(n).find((m) => m.kind === kind);
      if (!market) continue;
      const label = `Map ${n}${match.mapNames[n - 1] ? ` (${match.mapNames[n - 1]})` : ""} · ${KIND_LABEL[kind]}`;
      if (market.status === "open") return { type: "close", market, label };
      if (market.status === "closed") return { type: "settle", market, label };
    }
  }
  return null;
}
