import type { Row } from "@libsql/client";
import { getDb, writeTx, STARTING_BALANCE } from "./db";
import { wakeEventStreams } from "./live";
import { quote } from "./odds";
import {
  MARKET_KINDS,
  type BetStatus,
  type BetView,
  type LeaderboardRow,
  type LiveEvent,
  type LiveEventKind,
  type Market,
  type MarketKind,
  type MarketStatus,
  type Match,
  type Pick,
  type User,
} from "./types";

/** An error whose message is safe to show to the user. */
export class UserError extends Error {}

/** Reject a bet if the price got more than this much worse than what the user saw. */
const SLIPPAGE_TOLERANCE = 0.03;

function toUser(r: Row): User {
  return {
    id: String(r.id),
    nickname: r.nickname == null ? null : String(r.nickname),
    avatarUrl: r.avatar_url == null ? null : String(r.avatar_url),
    balance: Number(r.balance),
  };
}

function toMarket(r: Row): Market {
  return {
    id: Number(r.id),
    matchId: Number(r.match_id),
    mapNumber: Number(r.map_number),
    kind: r.kind as MarketKind,
    status: r.status as MarketStatus,
    oddsA: r.odds_a == null ? null : Number(r.odds_a),
    oddsB: r.odds_b == null ? null : Number(r.odds_b),
    stakeA: Number(r.stake_a),
    stakeB: Number(r.stake_b),
    result: (r.result as Pick | null) ?? null,
  };
}

function parseMapNames(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw));
    return Array.isArray(v) ? v.map((s) => String(s ?? "")) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- users

export async function upsertUser(u: {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO users (id, username, display_name, avatar_url, balance)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET
            username = excluded.username,
            display_name = excluded.display_name,
            avatar_url = excluded.avatar_url`,
    args: [u.id, u.username, u.displayName, u.avatarUrl, STARTING_BALANCE],
  });
}

export async function getUserById(id: string): Promise<User | null> {
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
  return rs.rows[0] ? toUser(rs.rows[0]) : null;
}

/** Set the public name a player goes by. Must be unique, ignoring case. */
export async function setNickname(userId: string, nickname: string): Promise<void> {
  const db = await getDb();
  try {
    await db.execute({
      sql: "UPDATE users SET nickname = ? WHERE id = ?",
      args: [nickname, userId],
    });
  } catch (e) {
    if (String((e as Error).message).includes("UNIQUE")) {
      throw new UserError("Someone already has that nickname. Try another.");
    }
    throw e;
  }
}

/** Players who have picked a nickname, richest first. */
export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  const db = await getDb();
  const rs = await db.execute(
    `SELECT u.id, u.nickname, u.avatar_url, u.balance, u.created_at,
            COALESCE(SUM(CASE WHEN b.status = 'pending' THEN b.stake END), 0) AS in_play,
            COALESCE(SUM(b.status = 'won'), 0) AS wins,
            COALESCE(SUM(b.status = 'lost'), 0) AS losses
     FROM users u LEFT JOIN bets b ON b.user_id = u.id
     WHERE u.nickname IS NOT NULL
     GROUP BY u.id`,
  );
  return rs.rows
    .map((r) => ({
      id: String(r.id),
      displayName: String(r.nickname),
      avatarUrl: r.avatar_url == null ? null : String(r.avatar_url),
      balance: Number(r.balance),
      inPlay: Number(r.in_play),
      wins: Number(r.wins),
      losses: Number(r.losses),
      createdAt: Number(r.created_at),
    }))
    .sort((x, y) => y.balance + y.inPlay - (x.balance + x.inPlay) || x.createdAt - y.createdAt);
}

// ---------------------------------------------------------------- matches

export async function listMatches(archived: boolean): Promise<Match[]> {
  const db = await getDb();
  const ms = await db.execute({
    sql: `SELECT * FROM matches WHERE archived = ?
          ORDER BY starts_at IS NULL, starts_at, id`,
    args: [archived ? 1 : 0],
  });
  if (ms.rows.length === 0) return [];
  const ids = ms.rows.map((r) => Number(r.id));
  const mk = await db.execute({
    sql: `SELECT * FROM markets WHERE match_id IN (${ids.map(() => "?").join(",")})
          ORDER BY map_number, id`,
    args: ids,
  });
  const byMatch = new Map<number, Market[]>();
  for (const r of mk.rows) {
    const m = toMarket(r);
    byMatch.set(m.matchId, [...(byMatch.get(m.matchId) ?? []), m]);
  }
  return ms.rows.map((r) => ({
    id: Number(r.id),
    label: String(r.label),
    teamA: String(r.team_a),
    teamB: String(r.team_b),
    bestOf: Number(r.best_of),
    startsAt: r.starts_at == null ? null : Number(r.starts_at),
    archived: Number(r.archived) === 1,
    mapNames: parseMapNames(r.map_names),
    markets: byMatch.get(Number(r.id)) ?? [],
  }));
}

export interface MatchInput {
  label: string;
  teamA: string;
  teamB: string;
  startsAt: number | null;
}

export async function createMatch(input: MatchInput & { bestOf: number }): Promise<void> {
  await writeTx(async (tx) => {
    const rs = await tx.execute({
      sql: `INSERT INTO matches (label, team_a, team_b, best_of, starts_at, map_names)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        input.label,
        input.teamA,
        input.teamB,
        input.bestOf,
        input.startsAt,
        JSON.stringify(Array(input.bestOf).fill("")),
      ],
    });
    const matchId = Number(rs.lastInsertRowid);
    for (let map = 1; map <= input.bestOf; map++) {
      for (const kind of MARKET_KINDS) {
        await tx.execute({
          sql: "INSERT INTO markets (match_id, map_number, kind) VALUES (?, ?, ?)",
          args: [matchId, map, kind],
        });
      }
    }
  });
}

export async function updateMatch(id: number, input: MatchInput): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: "UPDATE matches SET label = ?, team_a = ?, team_b = ?, starts_at = ? WHERE id = ?",
    args: [input.label, input.teamA, input.teamB, input.startsAt, id],
  });
}

export async function setMatchArchived(id: number, archived: boolean): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: "UPDATE matches SET archived = ? WHERE id = ?",
    args: [archived ? 1 : 0, id],
  });
}

export async function deleteMatch(id: number): Promise<void> {
  await writeTx(async (tx) => {
    const rs = await tx.execute({
      sql: `SELECT COUNT(*) AS n FROM bets
            WHERE market_id IN (SELECT id FROM markets WHERE match_id = ?)`,
      args: [id],
    });
    if (Number(rs.rows[0].n) > 0) {
      throw new UserError("This match has bets on it. Void its markets and archive it instead.");
    }
    await tx.execute({ sql: "DELETE FROM markets WHERE match_id = ?", args: [id] });
    await tx.execute({ sql: "DELETE FROM matches WHERE id = ?", args: [id] });
  });
}

// ---------------------------------------------------------------- markets (admin)

export interface OddsInput {
  marketId: number;
  oddsA: number | null;
  oddsB: number | null;
}

/** Save a map's name and the provided odds for its markets. */
export async function saveMap(
  matchId: number,
  mapNumber: number,
  name: string,
  odds: OddsInput[],
): Promise<void> {
  await writeTx(async (tx) => {
    const rs = await tx.execute({
      sql: "SELECT map_names, best_of FROM matches WHERE id = ?",
      args: [matchId],
    });
    if (!rs.rows[0]) throw new UserError("Match not found.");
    const bestOf = Number(rs.rows[0].best_of);
    if (mapNumber < 1 || mapNumber > bestOf) throw new UserError("No such map.");
    const names = parseMapNames(rs.rows[0].map_names);
    while (names.length < bestOf) names.push("");
    names[mapNumber - 1] = name;
    await tx.execute({
      sql: "UPDATE matches SET map_names = ? WHERE id = ?",
      args: [JSON.stringify(names), matchId],
    });
    for (const o of odds) {
      const cur = await tx.execute({
        sql: "SELECT status FROM markets WHERE id = ? AND match_id = ? AND map_number = ?",
        args: [o.marketId, matchId, mapNumber],
      });
      const status = cur.rows[0]?.status;
      // Settled and voided markets keep the odds they were priced with.
      if (status !== "draft" && status !== "open" && status !== "closed") continue;
      if (status !== "draft" && (o.oddsA == null || o.oddsB == null)) {
        throw new UserError("Can't clear the odds on a market that's already been opened.");
      }
      await tx.execute({
        sql: "UPDATE markets SET odds_a = ?, odds_b = ? WHERE id = ?",
        args: [o.oddsA, o.oddsB, o.marketId],
      });
    }
  });
}

/** Open or close one market. Opening requires provided odds. */
export async function setMarketOpen(marketId: number, open: boolean): Promise<void> {
  const db = await getDb();
  const rs = open
    ? await db.execute({
        sql: `UPDATE markets SET status = 'open'
              WHERE id = ? AND status IN ('draft','closed')
                AND odds_a IS NOT NULL AND odds_b IS NOT NULL`,
        args: [marketId],
      })
    : await db.execute({
        sql: "UPDATE markets SET status = 'closed' WHERE id = ? AND status = 'open'",
        args: [marketId],
      });
  if (rs.rowsAffected === 0) {
    throw new UserError(
      open
        ? "Can't open: the market needs odds for both teams and must be in draft or closed."
        : "That market isn't open.",
    );
  }
}

/**
 * Open every draft market that has odds, or close every open market, for a
 * whole match or a single map. Returns how many markets changed.
 */
export async function bulkSetOpen(
  matchId: number,
  mapNumber: number | null,
  open: boolean,
): Promise<number> {
  const db = await getDb();
  const mapFilter = mapNumber == null ? "" : " AND map_number = ?";
  const args = mapNumber == null ? [matchId] : [matchId, mapNumber];
  const rs = await db.execute({
    sql: open
      ? `UPDATE markets SET status = 'open'
         WHERE match_id = ? AND status = 'draft'
           AND odds_a IS NOT NULL AND odds_b IS NOT NULL${mapFilter}`
      : `UPDATE markets SET status = 'closed' WHERE match_id = ? AND status = 'open'${mapFilter}`,
    args,
  });
  return rs.rowsAffected;
}

/** Close the market (if needed), record the winner and pay out winning bets. */
export async function settleMarket(marketId: number, result: Pick): Promise<void> {
  await writeTx(async (tx) => {
    const rs = await tx.execute({
      sql: "SELECT status FROM markets WHERE id = ?",
      args: [marketId],
    });
    const status = rs.rows[0]?.status;
    if (status !== "open" && status !== "closed") {
      throw new UserError("Only open or closed markets can be paid out.");
    }
    await tx.execute({
      sql: `INSERT INTO events (user_id, bet_id, kind, amount)
            SELECT user_id, id,
                   CASE WHEN pick = ? THEN 'won' ELSE 'lost' END,
                   CASE WHEN pick = ? THEN payout ELSE -stake END
            FROM bets WHERE market_id = ? AND status = 'pending'`,
      args: [result, result, marketId],
    });
    await tx.execute({
      sql: `UPDATE users SET balance = balance + (
              SELECT SUM(payout) FROM bets
              WHERE bets.user_id = users.id AND market_id = ? AND pick = ? AND status = 'pending')
            WHERE id IN (
              SELECT user_id FROM bets WHERE market_id = ? AND pick = ? AND status = 'pending')`,
      args: [marketId, result, marketId, result],
    });
    await tx.execute({
      sql: `UPDATE bets SET status = CASE WHEN pick = ? THEN 'won' ELSE 'lost' END
            WHERE market_id = ? AND status = 'pending'`,
      args: [result, marketId],
    });
    await tx.execute({
      sql: "UPDATE markets SET status = 'settled', result = ? WHERE id = ?",
      args: [result, marketId],
    });
  });
  wakeEventStreams();
}

/** Cancel a market (e.g. a map that never gets played) and refund every stake. */
export async function voidMarket(marketId: number): Promise<void> {
  await writeTx(async (tx) => {
    const rs = await tx.execute({
      sql: "SELECT status FROM markets WHERE id = ?",
      args: [marketId],
    });
    const status = rs.rows[0]?.status;
    if (status !== "draft" && status !== "open" && status !== "closed") {
      throw new UserError("Only unsettled markets can be voided.");
    }
    await tx.execute({
      sql: `INSERT INTO events (user_id, bet_id, kind, amount)
            SELECT user_id, id, 'refunded', stake
            FROM bets WHERE market_id = ? AND status = 'pending'`,
      args: [marketId],
    });
    await tx.execute({
      sql: `UPDATE users SET balance = balance + (
              SELECT SUM(stake) FROM bets
              WHERE bets.user_id = users.id AND market_id = ? AND status = 'pending')
            WHERE id IN (SELECT user_id FROM bets WHERE market_id = ? AND status = 'pending')`,
      args: [marketId, marketId],
    });
    await tx.execute({
      sql: "UPDATE bets SET status = 'refunded' WHERE market_id = ? AND status = 'pending'",
      args: [marketId],
    });
    await tx.execute({
      sql: "UPDATE markets SET status = 'void', result = NULL WHERE id = ?",
      args: [marketId],
    });
  });
  wakeEventStreams();
}

/**
 * Undo a payout or a void: claw the credits back, put the bets back to
 * pending and return the market to closed (or draft if it never had odds).
 * Balances can go negative if a user has already re-staked the winnings.
 */
export async function unsettleMarket(marketId: number): Promise<void> {
  await writeTx(async (tx) => {
    const rs = await tx.execute({
      sql: "SELECT status, odds_a FROM markets WHERE id = ?",
      args: [marketId],
    });
    const status = rs.rows[0]?.status;
    if (status !== "settled" && status !== "void") {
      throw new UserError("That market hasn't been paid out or voided.");
    }
    const [betStatus, column] = status === "settled" ? ["won", "payout"] : ["refunded", "stake"];
    await tx.execute({
      sql: `INSERT INTO events (user_id, bet_id, kind, amount)
            SELECT user_id, id, 'reversed',
                   CASE status WHEN 'won' THEN -payout WHEN 'refunded' THEN -stake ELSE 0 END
            FROM bets WHERE market_id = ? AND status != 'pending'`,
      args: [marketId],
    });
    await tx.execute({
      sql: `UPDATE users SET balance = balance - (
              SELECT SUM(${column}) FROM bets
              WHERE bets.user_id = users.id AND market_id = ? AND status = ?)
            WHERE id IN (SELECT user_id FROM bets WHERE market_id = ? AND status = ?)`,
      args: [marketId, betStatus, marketId, betStatus],
    });
    await tx.execute({
      sql: "UPDATE bets SET status = 'pending' WHERE market_id = ? AND status != 'pending'",
      args: [marketId],
    });
    await tx.execute({
      sql: "UPDATE markets SET status = ?, result = NULL WHERE id = ?",
      args: [rs.rows[0].odds_a == null ? "draft" : "closed", marketId],
    });
  });
  wakeEventStreams();
}

// ---------------------------------------------------------------- bets

export async function placeBet(input: {
  userId: string;
  marketId: number;
  pick: Pick;
  stake: number;
  /** The odds the user was shown for this stake. */
  quotedOdds: number;
}): Promise<{ odds: number; payout: number }> {
  const { userId, marketId, pick, stake, quotedOdds } = input;
  if (!Number.isInteger(stake) || stake < 1) throw new UserError("Enter a stake of at least 1.");
  return writeTx(async (tx) => {
    const mr = await tx.execute({ sql: "SELECT * FROM markets WHERE id = ?", args: [marketId] });
    const market = mr.rows[0] ? toMarket(mr.rows[0]) : null;
    if (!market || market.status !== "open") {
      throw new UserError("Betting is closed on this market.");
    }
    const ur = await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [userId] });
    if (!ur.rows[0]) throw new UserError("Account not found. Log in again.");
    if (stake > Number(ur.rows[0].balance)) throw new UserError("You don't have enough credits.");

    const q = quote(market, pick, stake);
    if (!q) throw new UserError("Betting is closed on this market.");
    if (q.odds < quotedOdds * (1 - SLIPPAGE_TOLERANCE)) {
      throw new UserError(`The odds moved to ${q.odds.toFixed(2)}. Check the new price and try again.`);
    }

    await tx.execute({
      sql: "UPDATE users SET balance = balance - ? WHERE id = ?",
      args: [stake, userId],
    });
    await tx.execute({
      sql: `UPDATE markets SET ${pick === "a" ? "stake_a = stake_a" : "stake_b = stake_b"} + ?
            WHERE id = ?`,
      args: [stake, marketId],
    });
    await tx.execute({
      sql: "INSERT INTO bets (user_id, market_id, pick, stake, odds, payout) VALUES (?, ?, ?, ?, ?, ?)",
      args: [userId, marketId, pick, stake, q.odds, q.payout],
    });
    return { odds: q.odds, payout: q.payout };
  });
}

export async function listUserBets(userId: string, limit = 300): Promise<BetView[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT b.id, b.market_id, b.pick, b.stake, b.odds, b.payout, b.status, b.created_at,
                 m.match_id, m.map_number, m.kind,
                 x.label, x.team_a, x.team_b, x.map_names
          FROM bets b
          JOIN markets m ON m.id = b.market_id
          JOIN matches x ON x.id = m.match_id
          WHERE b.user_id = ?
          ORDER BY b.id DESC LIMIT ?`,
    args: [userId, limit],
  });
  return rs.rows.map((r) => ({
    id: Number(r.id),
    marketId: Number(r.market_id),
    matchId: Number(r.match_id),
    label: String(r.label),
    teamA: String(r.team_a),
    teamB: String(r.team_b),
    mapNumber: Number(r.map_number),
    mapName: parseMapNames(r.map_names)[Number(r.map_number) - 1] ?? "",
    kind: r.kind as MarketKind,
    pick: r.pick as Pick,
    stake: Number(r.stake),
    odds: Number(r.odds),
    payout: Number(r.payout),
    status: r.status as BetStatus,
    createdAt: Number(r.created_at),
  }));
}

// ---------------------------------------------------------------- live events

/** Id of the newest event, used as the starting point for a first-time listener. */
export async function latestEventId(): Promise<number> {
  const db = await getDb();
  const rs = await db.execute("SELECT COALESCE(MAX(id), 0) AS id FROM events");
  return Number(rs.rows[0].id);
}

export async function listEventsAfter(userId: string, afterId: number): Promise<LiveEvent[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT e.id, e.kind, e.amount, b.pick, b.odds, m.map_number, m.kind AS market_kind,
                 x.team_a, x.team_b, x.map_names
          FROM events e
          JOIN bets b ON b.id = e.bet_id
          JOIN markets m ON m.id = b.market_id
          JOIN matches x ON x.id = m.match_id
          WHERE e.user_id = ? AND e.id > ?
          ORDER BY e.id LIMIT 100`,
    args: [userId, afterId],
  });
  return rs.rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind as LiveEventKind,
    amount: Number(r.amount),
    team: String(r.pick === "a" ? r.team_a : r.team_b),
    mapNumber: Number(r.map_number),
    mapName: parseMapNames(r.map_names)[Number(r.map_number) - 1] ?? "",
    marketKind: r.market_kind as MarketKind,
    odds: Number(r.odds),
  }));
}
