import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type Client, type Transaction } from "@libsql/client";

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
CREATE TABLE IF NOT EXISTS markets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id),
  map_number INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('map','pistol1','pistol2')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','settled','void')),
  odds_a REAL,
  odds_b REAL,
  stake_a INTEGER NOT NULL DEFAULT 0,
  stake_b INTEGER NOT NULL DEFAULT 0,
  result TEXT CHECK (result IN ('a','b')),
  UNIQUE (match_id, map_number, kind)
);
CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  market_id INTEGER NOT NULL REFERENCES markets(id),
  pick TEXT NOT NULL CHECK (pick IN ('a','b')),
  stake INTEGER NOT NULL CHECK (stake > 0),
  odds REAL NOT NULL,
  payout INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','won','lost','refunded')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  bet_id INTEGER NOT NULL REFERENCES bets(id),
  kind TEXT NOT NULL CHECK (kind IN ('won','lost','refunded','reversed')),
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS events_user ON events(user_id, id);
CREATE INDEX IF NOT EXISTS bets_user ON bets(user_id);
CREATE INDEX IF NOT EXISTS bets_market ON bets(market_id);
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
  // Added after the first version: the public name a player picks for themselves.
  const cols = await client.execute("PRAGMA table_info(users)");
  if (!cols.rows.some((r) => r.name === "nickname")) {
    await client.execute("ALTER TABLE users ADD COLUMN nickname TEXT");
  }
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_nickname ON users(nickname COLLATE NOCASE)",
  );
  return client;
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
