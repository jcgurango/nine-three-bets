/** Which team an outcome belongs to: A is listed first, B second. */
export type Side = "a" | "b";
/**
 * `map`, `pistol1` and `pistol2` belong to one map; `match` (who wins the
 * series) and `score` (the exact map score) belong to the whole match and are
 * stored with map number 0.
 */
export type MarketKind = "map" | "pistol1" | "pistol2" | "match" | "score";
export type MarketStatus = "draft" | "open" | "closed" | "settled" | "void";
export type BetStatus = "pending" | "won" | "lost" | "refunded";

export const MAP_KINDS: MarketKind[] = ["map", "pistol1", "pistol2"];
export const MATCH_KINDS: MarketKind[] = ["match", "score"];

export const KIND_LABEL: Record<MarketKind, string> = {
  map: "Map winner",
  pistol1: "1st pistol",
  pistol2: "2nd pistol",
  match: "Match winner",
  score: "Correct score",
};

export interface User {
  id: string;
  /** The nickname the player chose. Null until they pick one; Discord names are never shown. */
  nickname: string | null;
  avatarUrl: string | null;
  balance: number;
}

export type LiveEventKind = "won" | "lost" | "refunded" | "reversed";

/** Something that happened to one of the viewer's bets, pushed over /api/events. */
export interface LiveEvent {
  id: number;
  kind: LiveEventKind;
  /** Signed change to show next to the balance: +payout, -stake lost, +refund, -clawback. */
  amount: number;
  /** What they bet on, e.g. "Paper Rex" or "Paper Rex 2:1". */
  label: string;
  mapNumber: number;
  mapName: string;
  marketKind: MarketKind;
  odds: number;
}

export interface Outcome {
  /** "a" / "b" for a team to win, or a map score like "2-1" (team A's maps first). */
  key: string;
  /** Provided (external) decimal odds. Null until an admin enters them. */
  odds: number | null;
  /** Total credits users have staked on this outcome. */
  stake: number;
}

export interface Market {
  id: number;
  matchId: number;
  /** 1-based map, or 0 for markets on the whole match. */
  mapNumber: number;
  kind: MarketKind;
  status: MarketStatus;
  outcomes: Outcome[];
  /** Key of the winning outcome once paid out. */
  result: string | null;
}

export interface Match {
  id: number;
  label: string;
  teamA: string;
  teamB: string;
  bestOf: number;
  /** Unix seconds. */
  startsAt: number | null;
  archived: boolean;
  mapNames: string[];
  markets: Market[];
}

export interface BetView {
  id: number;
  marketId: number;
  matchId: number;
  label: string;
  teamA: string;
  teamB: string;
  mapNumber: number;
  mapName: string;
  kind: MarketKind;
  pick: string;
  stake: number;
  odds: number;
  payout: number;
  status: BetStatus;
  createdAt: number;
}

export interface LeaderboardRow {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  balance: number;
  inPlay: number;
  wins: number;
  losses: number;
}

export type Result<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };
