export type Pick = "a" | "b";
export type MarketKind = "map" | "pistol1" | "pistol2";
export type MarketStatus = "draft" | "open" | "closed" | "settled" | "void";
export type BetStatus = "pending" | "won" | "lost" | "refunded";

export const MARKET_KINDS: MarketKind[] = ["map", "pistol1", "pistol2"];

export const KIND_LABEL: Record<MarketKind, string> = {
  map: "Map winner",
  pistol1: "1st pistol",
  pistol2: "2nd pistol",
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
  team: string;
  mapNumber: number;
  mapName: string;
  marketKind: MarketKind;
  odds: number;
}

export interface Market {
  id: number;
  matchId: number;
  mapNumber: number;
  kind: MarketKind;
  status: MarketStatus;
  /** Provided (external) decimal odds. Null until an admin enters them. */
  oddsA: number | null;
  oddsB: number | null;
  /** Total credits staked on each side by users. */
  stakeA: number;
  stakeB: number;
  result: Pick | null;
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
  pick: Pick;
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
