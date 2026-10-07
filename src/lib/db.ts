import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type Client, type Transaction } from "@libsql/client";
import { matchLevelMarkets } from "./outcomes";

export const STARTING_BALANCE = 50_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  balance INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL DEFAULT '',
  team_a TEXT NOT NULL,
  team_b TEXT NOT NULL,
  best_of INTEGER NOT NULL DEFAULT 3,
  starts_at INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  map_names TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS markets_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id),
  map_number INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','settled','void')),
  result TEXT,
  UNIQUE (match_id, map_number, kind)
);
CREATE TABLE IF NOT EXISTS outcomes (
  market_id INTEGER NOT NULL REFERENCES markets_v2(id),
  key TEXT NOT NULL,
  position INTEGER NOT NULL,
  odds REAL,
  stake INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (market_id, key)
);
CREATE TABLE IF NOT EXISTS bets_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  market_id INTEGER NOT NULL REFERENCES markets_v2(id),
  pick TEXT NOT NULL,
  stake INTEGER NOT NULL CHECK (stake > 0),
  odds REAL NOT NULL,
  payout INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','won','lost','refunded')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS events_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  bet_id INTEGER NOT NULL REFERENCES bets_v2(id),
  kind TEXT NOT NULL CHECK (kind IN ('won','lost','refunded','reversed')),
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS events_v2_user ON events_v2(user_id, id);
CREATE INDEX IF NOT EXISTS bets_v2_user ON bets_v2(user_id);
CREATE INDEX IF NOT EXISTS bets_v2_market ON bets_v2(market_id);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  debt_delta INTEGER NOT NULL DEFAULT 0,
  ref_type TEXT,
  ref_id INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id, id);
CREATE INDEX IF NOT EXISTS ledger_ref ON ledger(ref_type, ref_id);
`;

// Survive dev-server module reloads with a single client.
const globalForDb = globalThis as unknown as {
  __db?: Promise<Client>;
  __dbWriteChain?: Promise<unknown>;
};

async function init(): Promise<Client> {
  const url = process.env.DATABASE_URL || "file:./data/ninethree.db";
  const isFile = url.startsWith("file:");
  if (isFile) mkdirSync(dirname(url.slice("file:".length)), { recursive: true });
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  if (isFile) await client.execute("PRAGMA journal_mode = WAL");
  await client.executeMultiple(SCHEMA);
  // Columns added after the first version.
  // The public name a player picks for themselves.
  await addColumn(client, "users", "nickname", "TEXT");
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_nickname ON users(nickname COLLATE NOCASE)",
  );
  // Link to the match on the site odds are scraped from (see /ingest): its id
  // there, whether that site lists the two teams in the opposite order to us,
  // and when its odds were last scraped (unix ms).
  await addColumn(client, "matches", "external_id", "TEXT");
  await addColumn(client, "matches", "external_flipped", "INTEGER NOT NULL DEFAULT 0");
  await addColumn(client, "matches", "scraped_at", "INTEGER");
  // Correct scores ruled out by map results, and markets the site paid out by itself.
  await addColumn(client, "outcomes", "eliminated", "INTEGER NOT NULL DEFAULT 0");
  await addColumn(client, "markets_v2", "auto_settled", "INTEGER NOT NULL DEFAULT 0");
  // Loans: what the player owes now, and everything they've ever borrowed.
  await addColumn(client, "users", "debt", "INTEGER NOT NULL DEFAULT 0");
  await addColumn(client, "users", "borrowed", "INTEGER NOT NULL DEFAULT 0");
  // When the per-match stipend went out and when the match was finalized (unix seconds).
  await addColumn(client, "matches", "stipend_paid_at", "INTEGER");
  await addColumn(client, "matches", "finalized_at", "INTEGER");
  // Extra wording on a result, e.g. how much of a win went to a loan.
  await addColumn(client, "events_v2", "note", "TEXT");
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS matches_external_id ON matches(external_id)",
  );
  await migrateToV2(client);
  await backfillLedger(client);
  return client;
}

async function addColumn(client: Client, table: string, column: string, type: string) {
  const cols = await client.execute(`PRAGMA table_info(${table})`);
  if (!cols.rows.some((r) => r.name === column)) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/**
 * Version 1 stored exactly two outcomes per market, in columns on `markets`.
 * Version 2 gives each market any number of outcomes (needed for correct
 * score) in `markets_v2` + `outcomes`, with `bets_v2` and `events_v2` pointing
 * at them. Data is copied across once with its ids intact; the version 1
 * tables are left untouched as a backup and are no longer read.
 */
async function migrateToV2(client: Client): Promise<void> {
  const tx = await client.transaction("write");
  try {
    const version = await tx.execute("SELECT value FROM meta WHERE key = 'schema_version'");
    if (Number(version.rows[0]?.value ?? 1) >= 2) return;

    const legacy = await tx.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('markets','bets','events')",
    );
    const has = (name: string) => legacy.rows.some((r) => r.name === name);
    if (has("markets")) {
      await tx.execute(
        `INSERT INTO markets_v2 (id, match_id, map_number, kind, status, result)
         SELECT id, match_id, map_number, kind, status, result FROM markets`,
      );
      await tx.execute(
        `INSERT INTO outcomes (market_id, key, position, odds, stake)
         SELECT id, 'a', 0, odds_a, stake_a FROM markets
         UNION ALL
         SELECT id, 'b', 1, odds_b, stake_b FROM markets`,
      );
    }
    if (has("bets")) {
      await tx.execute(
        `INSERT INTO bets_v2 (id, user_id, market_id, pick, stake, odds, payout, status, created_at)
         SELECT id, user_id, market_id, pick, stake, odds, payout, status, created_at FROM bets`,
      );
    }
    if (has("events")) {
      await tx.execute(
        `INSERT INTO events_v2 (id, user_id, bet_id, kind, amount, created_at)
         SELECT id, user_id, bet_id, kind, amount, created_at FROM events`,
      );
    }

    // Matches created before match-level markets existed get them now, as drafts.
    const matches = await tx.execute("SELECT id, best_of FROM matches");
    for (const m of matches.rows) {
      for (const [kind, keys] of matchLevelMarkets(Number(m.best_of))) {
        const market = await tx.execute({
          sql: "INSERT INTO markets_v2 (match_id, map_number, kind) VALUES (?, 0, ?)",
          args: [m.id, kind],
        });
        for (const [position, key] of keys.entries()) {
          await tx.execute({
            sql: "INSERT INTO outcomes (market_id, key, position) VALUES (?, ?, ?)",
            args: [market.lastInsertRowid!, key, position],
          });
        }
      }
    }

    await tx.execute(
      "INSERT INTO meta (key, value) VALUES ('schema_version', '2') ON CONFLICT (key) DO UPDATE SET value = '2'",
    );
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    tx.close();
  }
}

/**
 * Version 3 introduced the ledger. Balances that existed before it get
 * reconstructed entries (sign-up credits, stakes, payouts, refunds, dated by
 * the bet) plus one adjustment per player if that doesn't add up to their
 * balance, so every balance is explained by its ledger from here on.
 */
async function backfillLedger(client: Client): Promise<void> {
  const tx = await client.transaction("write");
  try {
    const version = await tx.execute("SELECT value FROM meta WHERE key = 'schema_version'");
    if (Number(version.rows[0]?.value ?? 1) >= 3) return;

    await tx.execute(
      `INSERT INTO ledger (user_id, kind, amount, created_at)
       SELECT id, 'signup', ${STARTING_BALANCE}, created_at FROM users`,
    );
    await tx.execute(
      `INSERT INTO ledger (user_id, kind, amount, ref_type, ref_id, created_at)
       SELECT user_id, 'bet', -stake, 'bet', id, created_at FROM bets_v2`,
    );
    await tx.execute(
      `INSERT INTO ledger (user_id, kind, amount, ref_type, ref_id, created_at)
       SELECT user_id, 'payout', payout, 'bet', id, created_at FROM bets_v2 WHERE status = 'won'`,
    );
    await tx.execute(
      `INSERT INTO ledger (user_id, kind, amount, ref_type, ref_id, created_at)
       SELECT user_id, 'refund', stake, 'bet', id, created_at FROM bets_v2 WHERE status = 'refunded'`,
    );
    await tx.execute(
      `INSERT INTO ledger (user_id, kind, amount, note, created_at)
       SELECT u.id, 'adjustment', u.balance - COALESCE(l.total, 0), 'Balance before the ledger existed', unixepoch()
       FROM users u LEFT JOIN (SELECT user_id, SUM(amount) AS total FROM ledger GROUP BY user_id) l
         ON l.user_id = u.id
       WHERE u.balance != COALESCE(l.total, 0)`,
    );
    await tx.execute(
      "INSERT INTO meta (key, value) VALUES ('schema_version', '3') ON CONFLICT (key) DO UPDATE SET value = '3'",
    );
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    tx.close();
  }
}

export function getDb(): Promise<Client> {
  return (globalForDb.__db ??= init());
}

/**
 * Run `fn` in a write transaction. Writes are queued in-process so concurrent
 * bets on a local SQLite file wait their turn instead of failing with
 * SQLITE_BUSY.
 */
export function writeTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const run = async () => {
    const db = await getDb();
    const tx = await db.transaction("write");
    try {
      const out = await fn(tx);
      await tx.commit();
      return out;
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    } finally {
      tx.close();
    }
  };
  const p = (globalForDb.__dbWriteChain ?? Promise.resolve()).then(run, run);
  globalForDb.__dbWriteChain = p.catch(() => {});
  return p;
}
