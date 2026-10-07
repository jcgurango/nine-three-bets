import type { Row, Transaction } from "@libsql/client";
import { getDb, writeTx, STARTING_BALANCE } from "./db";
import { UserError } from "./errors";
import { wakeEventStreams } from "./live";
import { quote } from "./odds";
import { TEAM_OUTCOMES, marketLabel, matchLevelMarkets, outcomeLabel } from "./outcomes";
import { flipOdds, sameTeam, type ParsedScrape, type Skipped } from "./scrape";
import {
  MAP_KINDS,
  type BetStatus,
  type BetView,
  type LeaderboardRow,
  type LiveEvent,
  type LiveEventKind,
  type Market,
  type MarketKind,
  type MarketStatus,
  type Match,
  type Outcome,
  type User,
} from "./types";

export { UserError };

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

function toOutcome(r: Row): Outcome {
  return {
    key: String(r.key),
    odds: r.odds == null ? null : Number(r.odds),
    stake: Number(r.stake),
    eliminated: Number(r.eliminated) === 1,
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
     FROM users u LEFT JOIN bets_v2 b ON b.user_id = u.id
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
  const inMatches = `match_id IN (${ids.map(() => "?").join(",")})`;
  const [mk, oc] = await Promise.all([
    db.execute({
      sql: `SELECT * FROM markets_v2 WHERE ${inMatches} ORDER BY map_number, id`,
      args: ids,
    }),
    db.execute({
      sql: `SELECT * FROM outcomes
            WHERE market_id IN (SELECT id FROM markets_v2 WHERE ${inMatches})
            ORDER BY market_id, position`,
      args: ids,
    }),
  ]);
  const outcomesByMarket = new Map<number, Outcome[]>();
  for (const r of oc.rows) {
    const id = Number(r.market_id);
    outcomesByMarket.set(id, [...(outcomesByMarket.get(id) ?? []), toOutcome(r)]);
  }
  const marketsByMatch = new Map<number, Market[]>();
  for (const r of mk.rows) {
    const market: Market = {
      id: Number(r.id),
      matchId: Number(r.match_id),
      mapNumber: Number(r.map_number),
      kind: r.kind as MarketKind,
      status: r.status as MarketStatus,
      outcomes: outcomesByMarket.get(Number(r.id)) ?? [],
      result: r.result == null ? null : String(r.result),
      autoSettled: Number(r.auto_settled) === 1,
    };
    marketsByMatch.set(market.matchId, [...(marketsByMatch.get(market.matchId) ?? []), market]);
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
    scrapedAt: r.scraped_at == null ? null : Math.floor(Number(r.scraped_at) / 1000),
    markets: marketsByMatch.get(Number(r.id)) ?? [],
  }));
}

export interface MatchInput {
  label: string;
  teamA: string;
  teamB: string;
  startsAt: number | null;
}

async function insertMarket(
  tx: Transaction,
  matchId: number,
  mapNumber: number,
  kind: MarketKind,
  outcomeKeys: string[],
): Promise<void> {
  const rs = await tx.execute({
    sql: "INSERT INTO markets_v2 (match_id, map_number, kind) VALUES (?, ?, ?)",
    args: [matchId, mapNumber, kind],
  });
  for (const [position, key] of outcomeKeys.entries()) {
    await tx.execute({
      sql: "INSERT INTO outcomes (market_id, key, position) VALUES (?, ?, ?)",
      args: [Number(rs.lastInsertRowid), key, position],
    });
  }
}

async function insertMatch(tx: Transaction, input: MatchInput & { bestOf: number }): Promise<number> {
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
  for (const [kind, keys] of matchLevelMarkets(input.bestOf)) {
    await insertMarket(tx, matchId, 0, kind, keys);
  }
  for (let map = 1; map <= input.bestOf; map++) {
    for (const kind of MAP_KINDS) await insertMarket(tx, matchId, map, kind, TEAM_OUTCOMES);
  }
  return matchId;
}

export async function createMatch(input: MatchInput & { bestOf: number }): Promise<void> {
  await writeTx((tx) => insertMatch(tx, input));
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
      sql: `SELECT COUNT(*) AS n FROM bets_v2
            WHERE market_id IN (SELECT id FROM markets_v2 WHERE match_id = ?)`,
      args: [id],
    });
    if (Number(rs.rows[0].n) > 0) {
      throw new UserError("This match has bets on it. Void its markets and archive it instead.");
    }
    await tx.execute({
      sql: "DELETE FROM outcomes WHERE market_id IN (SELECT id FROM markets_v2 WHERE match_id = ?)",
      args: [id],
    });
    await tx.execute({ sql: "DELETE FROM markets_v2 WHERE match_id = ?", args: [id] });
    await tx.execute({ sql: "DELETE FROM matches WHERE id = ?", args: [id] });
  });
}

// ---------------------------------------------------------------- markets (admin)

export interface OddsInput {
  marketId: number;
  /** Provided decimal odds by outcome key. All null clears a draft market's odds. */
  odds: Record<string, number | null>;
}

/** A market can only take bets once every outcome still on the board has provided odds. */
const HAS_ALL_ODDS = `NOT EXISTS (
  SELECT 1 FROM outcomes
  WHERE outcomes.market_id = markets_v2.id AND outcomes.odds IS NULL AND outcomes.eliminated = 0)`;

/**
 * Save the provided odds for one group of a match's markets: a map (with its
 * name) or, for map number 0, the match-level markets.
 */
export async function saveOdds(
  matchId: number,
  mapNumber: number,
  mapName: string,
  odds: OddsInput[],
): Promise<void> {
  await writeTx(async (tx) => {
    const rs = await tx.execute({
      sql: "SELECT map_names, best_of FROM matches WHERE id = ?",
      args: [matchId],
    });
    if (!rs.rows[0]) throw new UserError("Match not found.");
    const bestOf = Number(rs.rows[0].best_of);
    if (mapNumber < 0 || mapNumber > bestOf) throw new UserError("No such map.");
    if (mapNumber > 0) {
      const names = parseMapNames(rs.rows[0].map_names);
      while (names.length < bestOf) names.push("");
      names[mapNumber - 1] = mapName;
      await tx.execute({
        sql: "UPDATE matches SET map_names = ? WHERE id = ?",
        args: [JSON.stringify(names), matchId],
      });
    }
    for (const o of odds) {
      const cur = await tx.execute({
        sql: "SELECT status FROM markets_v2 WHERE id = ? AND match_id = ? AND map_number = ?",
        args: [o.marketId, matchId, mapNumber],
      });
      const status = String(cur.rows[0]?.status);
      // Settled and voided markets keep the odds they were priced with.
      if (!UNSETTLED.includes(status)) continue;
      const keys = await tx.execute({
        sql: "SELECT key FROM outcomes WHERE market_id = ? AND eliminated = 0",
        args: [o.marketId],
      });
      const values = keys.rows.map((r) => o.odds[String(r.key)] ?? null);
      const filled = values.filter((v) => v != null).length;
      if (filled !== 0 && filled !== values.length) {
        throw new UserError("Enter odds for every outcome of a market, or leave them all blank.");
      }
      if (status !== "draft" && filled === 0) {
        throw new UserError("Can't clear the odds on a market that's already been opened.");
      }
      for (const [i, r] of keys.rows.entries()) {
        await tx.execute({
          sql: "UPDATE outcomes SET odds = ? WHERE market_id = ? AND key = ?",
          args: [values[i], o.marketId, r.key],
        });
      }
    }
  });
}

/** Open or close one market. Opening requires provided odds. */
export async function setMarketOpen(marketId: number, open: boolean): Promise<void> {
  const db = await getDb();
  const rs = open
    ? await db.execute({
        sql: `UPDATE markets_v2 SET status = 'open'
              WHERE id = ? AND status IN ('draft','closed') AND ${HAS_ALL_ODDS}`,
        args: [marketId],
      })
    : await db.execute({
        sql: "UPDATE markets_v2 SET status = 'closed' WHERE id = ? AND status = 'open'",
        args: [marketId],
      });
  if (rs.rowsAffected === 0) {
    throw new UserError(
      open
        ? "Can't open: the market needs odds for every outcome and must be in draft or closed."
        : "That market isn't open.",
    );
  }
}

/**
 * Open every draft market that has odds, or close every open market, for a
 * whole match (`mapNumber` null) or one group of it (a map, or 0 for the
 * match-level markets). Returns how many markets changed.
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
      ? `UPDATE markets_v2 SET status = 'open'
         WHERE match_id = ? AND status = 'draft' AND ${HAS_ALL_ODDS}${mapFilter}`
      : `UPDATE markets_v2 SET status = 'closed' WHERE match_id = ? AND status = 'open'${mapFilter}`,
    args,
  });
  return rs.rowsAffected;
}

const UNSETTLED = ["draft", "open", "closed"];

/** Settle a market: pay out bets on `result`, mark the rest lost. Bets on eliminated outcomes are already lost. */
async function settleInTx(tx: Transaction, marketId: number, result: string, auto: boolean) {
  const rs = await tx.execute({
    sql: `SELECT m.status, o.key FROM markets_v2 m
          LEFT JOIN outcomes o ON o.market_id = m.id AND o.key = ? AND o.eliminated = 0
          WHERE m.id = ?`,
    args: [result, marketId],
  });
  const status = String(rs.rows[0]?.status);
  // An admin pays out what was open for betting; the automatic settlement of a decided series may also close a draft.
  if (status !== "open" && status !== "closed" && !(auto && status === "draft")) {
    throw new UserError("Only open or closed markets can be paid out.");
  }
  if (rs.rows[0].key == null) throw new UserError("That isn't one of this market's possible outcomes.");
  await tx.execute({
    sql: `INSERT INTO events_v2 (user_id, bet_id, kind, amount)
          SELECT user_id, id,
                 CASE WHEN pick = ? THEN 'won' ELSE 'lost' END,
                 CASE WHEN pick = ? THEN payout ELSE -stake END
          FROM bets_v2 WHERE market_id = ? AND status = 'pending'`,
    args: [result, result, marketId],
  });
  await tx.execute({
    sql: `UPDATE users SET balance = balance + (
            SELECT SUM(payout) FROM bets_v2
            WHERE bets_v2.user_id = users.id AND market_id = ? AND pick = ? AND status = 'pending')
          WHERE id IN (
            SELECT user_id FROM bets_v2 WHERE market_id = ? AND pick = ? AND status = 'pending')`,
    args: [marketId, result, marketId, result],
  });
  await tx.execute({
    sql: `UPDATE bets_v2 SET status = CASE WHEN pick = ? THEN 'won' ELSE 'lost' END
          WHERE market_id = ? AND status = 'pending'`,
    args: [result, marketId],
  });
  await tx.execute({
    sql: "UPDATE markets_v2 SET status = 'settled', result = ?, auto_settled = ? WHERE id = ?",
    args: [result, auto ? 1 : 0, marketId],
  });
}

/**
 * Reverse a payout or a void: claw the credits back and put the bets back to
 * pending, except bets on eliminated outcomes, which stay lost. The market
 * returns to closed, or draft if it never had odds.
 */
async function unsettleInTx(tx: Transaction, marketId: number) {
  const rs = await tx.execute({
    sql: `SELECT status, ${HAS_ALL_ODDS} AS priced FROM markets_v2 WHERE id = ?`,
    args: [marketId],
  });
  const status = rs.rows[0]?.status;
  if (status !== "settled" && status !== "void") {
    throw new UserError("That market hasn't been paid out or voided.");
  }
  const [betStatus, column] = status === "settled" ? ["won", "payout"] : ["refunded", "stake"];
  const live = `pick NOT IN (SELECT key FROM outcomes WHERE outcomes.market_id = bets_v2.market_id AND eliminated = 1)`;
  await tx.execute({
    sql: `INSERT INTO events_v2 (user_id, bet_id, kind, amount)
          SELECT user_id, id, 'reversed',
                 CASE status WHEN 'won' THEN -payout WHEN 'refunded' THEN -stake ELSE 0 END
          FROM bets_v2 WHERE market_id = ? AND status != 'pending' AND ${live}`,
    args: [marketId],
  });
  await tx.execute({
    sql: `UPDATE users SET balance = balance - (
            SELECT SUM(${column}) FROM bets_v2
            WHERE bets_v2.user_id = users.id AND market_id = ? AND status = ? AND ${live})
          WHERE id IN (SELECT user_id FROM bets_v2 WHERE market_id = ? AND status = ? AND ${live})`,
    args: [marketId, betStatus, marketId, betStatus],
  });
  await tx.execute({
    sql: `UPDATE bets_v2 SET status = 'pending' WHERE market_id = ? AND status != 'pending' AND ${live}`,
    args: [marketId],
  });
  await tx.execute({
    sql: "UPDATE markets_v2 SET status = ?, result = NULL, auto_settled = 0 WHERE id = ?",
    args: [Number(rs.rows[0].priced) ? "closed" : "draft", marketId],
  });
}

/** Take an outcome off the board: pending bets on it lose now. Safe to repeat. */
async function eliminateOutcome(tx: Transaction, marketId: number, key: string) {
  await tx.execute({
    sql: `INSERT INTO events_v2 (user_id, bet_id, kind, amount)
          SELECT user_id, id, 'lost', -stake FROM bets_v2
          WHERE market_id = ? AND pick = ? AND status = 'pending'`,
    args: [marketId, key],
  });
  await tx.execute({
    sql: "UPDATE bets_v2 SET status = 'lost' WHERE market_id = ? AND pick = ? AND status = 'pending'",
    args: [marketId, key],
  });
  await tx.execute({
    sql: "UPDATE outcomes SET eliminated = 1 WHERE market_id = ? AND key = ?",
    args: [marketId, key],
  });
}

/** Put an eliminated outcome back (a map result was undone): its lost bets are open again. */
async function restoreOutcome(tx: Transaction, marketId: number, key: string) {
  await tx.execute({
    sql: `INSERT INTO events_v2 (user_id, bet_id, kind, amount)
          SELECT user_id, id, 'reversed', 0 FROM bets_v2
          WHERE market_id = ? AND pick = ? AND status = 'lost'`,
    args: [marketId, key],
  });
  await tx.execute({
    sql: "UPDATE bets_v2 SET status = 'pending' WHERE market_id = ? AND pick = ? AND status = 'lost'",
    args: [marketId, key],
  });
  await tx.execute({
    sql: "UPDATE outcomes SET eliminated = 0 WHERE market_id = ? AND key = ?",
    args: [marketId, key],
  });
}

/**
 * Bring the match-level markets in line with the map results so far. Correct
 * scores that can no longer happen are eliminated (bets on them lose), and
 * once only one score is left, or a team has won enough maps, the correct
 * score and match winner are paid out automatically. Undoing a map result
 * reverses all of that. Markets an admin paid out or voided by hand are left
 * alone.
 */
async function syncSeries(tx: Transaction, matchId: number) {
  const match = await tx.execute({ sql: "SELECT best_of FROM matches WHERE id = ?", args: [matchId] });
  const toWin = Math.ceil(Number(match.rows[0].best_of) / 2);
  const maps = await tx.execute({
    sql: "SELECT result FROM markets_v2 WHERE match_id = ? AND kind = 'map' AND status = 'settled'",
    args: [matchId],
  });
  const won = { a: 0, b: 0 };
  for (const r of maps.rows) won[r.result as "a" | "b"]++;
  const decided = won.a >= toWin ? "a" : won.b >= toWin ? "b" : null;
  // A score is still possible if neither team has lost more maps than it shows,
  // and once a team has won the series the score is simply the maps so far.
  const viable = (key: string) => {
    const [a, b] = key.split("-").map(Number);
    return decided ? a === won.a && b === won.b : a >= won.a && b >= won.b;
  };

  const level = await tx.execute({
    sql: "SELECT id, kind, status, result, auto_settled FROM markets_v2 WHERE match_id = ? AND map_number = 0",
    args: [matchId],
  });
  for (const m of level.rows) {
    const id = Number(m.id);
    let status = String(m.status);
    if (status === "void" || (status === "settled" && !Number(m.auto_settled))) continue;

    if (m.kind === "score") {
      const outcomes = (await tx.execute({ sql: "SELECT key, eliminated FROM outcomes WHERE market_id = ?", args: [id] })).rows;
      const live = outcomes.filter((o) => viable(String(o.key))).map((o) => String(o.key));
      if (status === "settled" && !(live.length === 1 && live[0] === m.result)) {
        await unsettleInTx(tx, id);
        status = "closed";
      }
      if (status !== "settled") {
        for (const o of outcomes) {
          if (!viable(String(o.key))) await eliminateOutcome(tx, id, String(o.key));
          else if (Number(o.eliminated)) await restoreOutcome(tx, id, String(o.key));
        }
        if (live.length === 1) await settleInTx(tx, id, live[0], true);
      }
    } else if (m.kind === "match") {
      if (status === "settled" && m.result !== decided) {
        await unsettleInTx(tx, id);
        status = "closed";
      }
      if (status !== "settled" && decided) await settleInTx(tx, id, decided, true);
    }
  }
}

/** The match a market belongs to, if it is a map winner (whose result shapes the match-level markets). */
async function seriesOf(tx: Transaction, marketId: number): Promise<number | null> {
  const rs = await tx.execute({
    sql: "SELECT match_id FROM markets_v2 WHERE id = ? AND kind = 'map'",
    args: [marketId],
  });
  return rs.rows[0] ? Number(rs.rows[0].match_id) : null;
}

/** Close the market (if needed), record the winning outcome and pay out winning bets. */
export async function settleMarket(marketId: number, result: string): Promise<void> {
  await writeTx(async (tx) => {
    await settleInTx(tx, marketId, result, false);
    const matchId = await seriesOf(tx, marketId);
    if (matchId != null) await syncSeries(tx, matchId);
  });
  wakeEventStreams();
}

/** Cancel a market (e.g. a map that never gets played) and refund every stake. */
export async function voidMarket(marketId: number): Promise<void> {
  await writeTx(async (tx) => {
    const rs = await tx.execute({
      sql: "SELECT status FROM markets_v2 WHERE id = ?",
      args: [marketId],
    });
    if (!UNSETTLED.includes(String(rs.rows[0]?.status))) {
      throw new UserError("Only unsettled markets can be voided.");
    }
    await tx.execute({
      sql: `INSERT INTO events_v2 (user_id, bet_id, kind, amount)
            SELECT user_id, id, 'refunded', stake
            FROM bets_v2 WHERE market_id = ? AND status = 'pending'`,
      args: [marketId],
    });
    await tx.execute({
      sql: `UPDATE users SET balance = balance + (
              SELECT SUM(stake) FROM bets_v2
              WHERE bets_v2.user_id = users.id AND market_id = ? AND status = 'pending')
            WHERE id IN (SELECT user_id FROM bets_v2 WHERE market_id = ? AND status = 'pending')`,
      args: [marketId, marketId],
    });
    await tx.execute({
      sql: "UPDATE bets_v2 SET status = 'refunded' WHERE market_id = ? AND status = 'pending'",
      args: [marketId],
    });
    await tx.execute({
      sql: "UPDATE markets_v2 SET status = 'void', result = NULL, auto_settled = 0 WHERE id = ?",
      args: [marketId],
    });
  });
  wakeEventStreams();
}

/**
 * Undo a payout or a void. Balances can go negative if a user has already
 * re-staked the winnings. Undoing a map result also brings back any correct
 * scores it had ruled out and reopens anything it settled automatically.
 */
export async function unsettleMarket(marketId: number): Promise<void> {
  await writeTx(async (tx) => {
    await unsettleInTx(tx, marketId);
    const matchId = await seriesOf(tx, marketId);
    if (matchId != null) await syncSeries(tx, matchId);
  });
  wakeEventStreams();
}

// ---------------------------------------------------------------- scraped odds

/** Whether a scraped outcome key that we don't list could be one of ours that's been eliminated. */
function viableKeyShape(key: string, live: string[]): boolean {
  const score = /^(\d+)-(\d+)$/.exec(key);
  if (!score) return live.includes(key);
  const toWin = Math.max(...live.flatMap((k) => k.split("-").map(Number)));
  return Math.max(Number(score[1]), Number(score[2])) === toWin;
}

export interface IngestResult {
  match: {
    id: number;
    teamA: string;
    teamB: string;
    /** No existing match fitted, so a new one was created (with every market in draft). */
    created: boolean;
  };
  /** Our markets whose provided odds were updated, with the odds by outcome name. */
  applied: { title: string; market: string; odds: Record<string, number> }[];
  /** Scraped markets that were not used, and why. */
  skipped: Skipped[];
}

/**
 * Apply a parsed scrape: find the match it belongs to (creating it if there
 * is none), then set the provided odds on each market it has prices for.
 * Markets are never opened, closed or paid out from here.
 *
 * The match is found by the scraped site's id if we've seen it before,
 * otherwise by team names among the active matches, in either order.
 */
export async function ingestScrape(scrape: ParsedScrape): Promise<IngestResult> {
  return writeTx(async (tx) => {
    let row: Row | undefined;
    let flipped = false;
    let created = false;

    if (scrape.externalId) {
      const rs = await tx.execute({
        sql: "SELECT * FROM matches WHERE external_id = ?",
        args: [scrape.externalId],
      });
      row = rs.rows[0];
      if (row) flipped = Number(row.external_flipped) === 1;
    }
    if (!row) {
      const rs = await tx.execute(
        `SELECT * FROM matches WHERE archived = 0 AND external_id IS NULL
         ORDER BY starts_at IS NULL, starts_at, id`,
      );
      for (const r of rs.rows) {
        const [a, b] = [String(r.team_a), String(r.team_b)];
        const straight = sameTeam(a, scrape.teams[0]) && sameTeam(b, scrape.teams[1]);
        const reversed = sameTeam(a, scrape.teams[1]) && sameTeam(b, scrape.teams[0]);
        if (straight === reversed) continue;
        row = r;
        flipped = reversed;
        break;
      }
    }
    if (!row) {
      const id = await insertMatch(tx, {
        label: scrape.tournament,
        teamA: scrape.teams[0],
        teamB: scrape.teams[1],
        bestOf: scrape.bestOf,
        startsAt: null,
      });
      row = (await tx.execute({ sql: "SELECT * FROM matches WHERE id = ?", args: [id] })).rows[0];
      created = true;
    }

    const matchId = Number(row.id);
    const result: IngestResult = {
      match: { id: matchId, teamA: String(row.team_a), teamB: String(row.team_b), created },
      applied: [],
      skipped: [...scrape.skipped],
    };
    if (row.scraped_at != null && Number(row.scraped_at) > scrape.scrapedAt) {
      throw new UserError("Ignored: newer odds for this match have already been ingested.");
    }

    const mapNames = parseMapNames(row.map_names);
    for (const market of scrape.markets) {
      const skip = (reason: string) => result.skipped.push({ title: market.title, reason });
      const odds = flipped ? flipOdds(market.odds) : market.odds;
      const mr = await tx.execute({
        sql: "SELECT id, status FROM markets_v2 WHERE match_id = ? AND map_number = ? AND kind = ?",
        args: [matchId, market.mapNumber, market.kind],
      });
      const target = mr.rows[0];
      if (!target) {
        skip(`this best of ${row.best_of} has no such market`);
        continue;
      }
      if (target.status === "settled" || target.status === "void") {
        skip(target.status === "settled" ? "already paid out" : "voided");
        continue;
      }
      // Outcomes already ruled out by map results are ignored; the rest must all be priced.
      const keys = (
        await tx.execute({
          sql: "SELECT key FROM outcomes WHERE market_id = ? AND eliminated = 0 ORDER BY position",
          args: [target.id],
        })
      ).rows.map((r) => String(r.key));
      const extra = Object.keys(odds).filter((k) => !keys.includes(k));
      if (keys.some((k) => !(k in odds)) || extra.some((k) => !viableKeyShape(k, keys))) {
        skip(`outcomes don't match this best of ${row.best_of} (expected ${keys.join(", ")})`);
        continue;
      }
      for (const key of keys) {
        await tx.execute({
          sql: "UPDATE outcomes SET odds = ? WHERE market_id = ? AND key = ?",
          args: [odds[key], target.id, key],
        });
      }
      result.applied.push({
        title: market.title,
        market: marketLabel(market.kind, market.mapNumber, mapNames[market.mapNumber - 1] ?? ""),
        odds: Object.fromEntries(
          keys.map((k) => [outcomeLabel(k, result.match.teamA, result.match.teamB), odds[k]]),
        ),
      });
    }

    await tx.execute({
      sql: `UPDATE matches SET scraped_at = ?,
              external_id = COALESCE(external_id, ?),
              external_flipped = CASE WHEN external_id IS NULL THEN ? ELSE external_flipped END
            WHERE id = ?`,
      args: [scrape.scrapedAt, scrape.externalId, flipped ? 1 : 0, matchId],
    });
    return result;
  });
}

// ---------------------------------------------------------------- bets

export async function placeBet(input: {
  userId: string;
  marketId: number;
  /** Key of the outcome being backed. */
  pick: string;
  stake: number;
  /** The odds the user was shown for this stake. */
  quotedOdds: number;
}): Promise<{ odds: number; payout: number }> {
  const { userId, marketId, pick, stake, quotedOdds } = input;
  if (!Number.isInteger(stake) || stake < 1) throw new UserError("Enter a stake of at least 1.");
  return writeTx(async (tx) => {
    const mr = await tx.execute({
      sql: "SELECT status FROM markets_v2 WHERE id = ?",
      args: [marketId],
    });
    if (mr.rows[0]?.status !== "open") throw new UserError("Betting is closed on this market.");
    const or = await tx.execute({
      sql: "SELECT * FROM outcomes WHERE market_id = ? ORDER BY position",
      args: [marketId],
    });
    const ur = await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [userId] });
    if (!ur.rows[0]) throw new UserError("Account not found. Log in again.");
    if (stake > Number(ur.rows[0].balance)) throw new UserError("You don't have enough credits.");

    const outcomes = or.rows.map(toOutcome);
    if (outcomes.find((o) => o.key === pick)?.eliminated) {
      throw new UserError("That result is no longer possible.");
    }
    const q = quote(outcomes, pick, stake);
    if (!q) throw new UserError("Betting is closed on this market.");
    if (q.odds < quotedOdds * (1 - SLIPPAGE_TOLERANCE)) {
      throw new UserError(`The odds moved to ${q.odds.toFixed(2)}. Check the new price and try again.`);
    }

    await tx.execute({
      sql: "UPDATE users SET balance = balance - ? WHERE id = ?",
      args: [stake, userId],
    });
    await tx.execute({
      sql: "UPDATE outcomes SET stake = stake + ? WHERE market_id = ? AND key = ?",
      args: [stake, marketId, pick],
    });
    await tx.execute({
      sql: "INSERT INTO bets_v2 (user_id, market_id, pick, stake, odds, payout) VALUES (?, ?, ?, ?, ?, ?)",
      args: [userId, marketId, pick, stake, q.odds, q.payout],
    });
    return { odds: q.odds, payout: q.payout };
  });
}

function toBetView(r: Row): BetView {
  return {
    id: Number(r.id),
    marketId: Number(r.market_id),
    matchId: Number(r.match_id),
    label: String(r.label),
    teamA: String(r.team_a),
    teamB: String(r.team_b),
    mapNumber: Number(r.map_number),
    mapName: parseMapNames(r.map_names)[Number(r.map_number) - 1] ?? "",
    kind: r.kind as MarketKind,
    pick: String(r.pick),
    stake: Number(r.stake),
    odds: Number(r.odds),
    payout: Number(r.payout),
    status: r.status as BetStatus,
    createdAt: Number(r.created_at),
  };
}

export async function listUserBets(userId: string, limit = 300): Promise<BetView[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT b.id, b.market_id, b.pick, b.stake, b.odds, b.payout, b.status, b.created_at,
                 m.match_id, m.map_number, m.kind,
                 x.label, x.team_a, x.team_b, x.map_names
          FROM bets_v2 b
          JOIN markets_v2 m ON m.id = b.market_id
          JOIN matches x ON x.id = m.match_id
          WHERE b.user_id = ?
          ORDER BY b.id DESC LIMIT ?`,
    args: [userId, limit],
  });
  return rs.rows.map(toBetView);
}

/** Every bet ever placed, oldest first, with the player's nickname. For the CSV export. */
export async function listAllBets(): Promise<(BetView & { nickname: string | null })[]> {
  const db = await getDb();
  const rs = await db.execute(
    `SELECT b.id, b.market_id, b.pick, b.stake, b.odds, b.payout, b.status, b.created_at,
            m.match_id, m.map_number, m.kind,
            x.label, x.team_a, x.team_b, x.map_names,
            u.nickname
     FROM bets_v2 b
     JOIN markets_v2 m ON m.id = b.market_id
     JOIN matches x ON x.id = m.match_id
     JOIN users u ON u.id = b.user_id
     ORDER BY b.id`,
  );
  return rs.rows.map((r) => ({
    ...toBetView(r),
    nickname: r.nickname == null ? null : String(r.nickname),
  }));
}

// ---------------------------------------------------------------- live events

/** Id of the newest event, used as the starting point for a first-time listener. */
export async function latestEventId(): Promise<number> {
  const db = await getDb();
  const rs = await db.execute("SELECT COALESCE(MAX(id), 0) AS id FROM events_v2");
  return Number(rs.rows[0].id);
}

export async function listEventsAfter(userId: string, afterId: number): Promise<LiveEvent[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT e.id, e.kind, e.amount, b.pick, b.odds, m.map_number, m.kind AS market_kind,
                 x.team_a, x.team_b, x.map_names
          FROM events_v2 e
          JOIN bets_v2 b ON b.id = e.bet_id
          JOIN markets_v2 m ON m.id = b.market_id
          JOIN matches x ON x.id = m.match_id
          WHERE e.user_id = ? AND e.id > ?
          ORDER BY e.id LIMIT 100`,
    args: [userId, afterId],
  });
  return rs.rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind as LiveEventKind,
    amount: Number(r.amount),
    label: outcomeLabel(String(r.pick), String(r.team_a), String(r.team_b)),
    mapNumber: Number(r.map_number),
    mapName: parseMapNames(r.map_names)[Number(r.map_number) - 1] ?? "",
    marketKind: r.market_kind as MarketKind,
    odds: Number(r.odds),
  }));
}
