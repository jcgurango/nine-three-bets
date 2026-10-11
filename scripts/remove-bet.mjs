/**
 * Remove a bet as if it was never placed: the stake goes back, the market's
 * pool shrinks, and the bet's ledger row disappears. No history, no toast.
 * Only open (pending) bets can be removed; a paid-out or refunded bet needs
 * the admin undo instead.
 *
 *   DATABASE_URL=file:./data/ninethree.db node scripts/remove-bet.mjs <bet id>
 *
 * Shows the bet and asks for a "yes" before touching anything. Stop the
 * server first when the database is a local file.
 */
import { createInterface } from "node:readline/promises";
import { createClient } from "@libsql/client";

const betId = Number(process.argv[2]);
if (!Number.isInteger(betId) || betId < 1) {
  console.error("Usage: node scripts/remove-bet.mjs <bet id>");
  process.exit(1);
}

const db = createClient({
  url: process.env.DATABASE_URL || "file:./data/ninethree.db",
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

const bet = (
  await db.execute({
    sql: `SELECT b.id, b.user_id, b.market_id, b.pick, b.stake, b.odds, b.status,
                 u.nickname, m.map_number, m.kind, x.team_a, x.team_b
          FROM bets_v2 b
          JOIN users u ON u.id = b.user_id
          JOIN markets_v2 m ON m.id = b.market_id
          JOIN matches x ON x.id = m.match_id
          WHERE b.id = ?`,
    args: [betId],
  })
).rows[0];
if (!bet) {
  console.error(`No bet #${betId}.`);
  process.exit(1);
}
const where = bet.map_number === 0 ? bet.kind : `map ${bet.map_number} ${bet.kind}`;
console.log(
  `Bet #${bet.id}: ${bet.nickname} staked ${bet.stake} on "${bet.pick}" @ ${bet.odds}` +
    ` (${bet.team_a} vs ${bet.team_b}, ${where}), status ${bet.status}.`,
);
if (bet.status !== "pending") {
  console.error("Only open bets can be removed. Undo the payout or void in admin first.");
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("Remove it and return the stake? (yes/no) ");
rl.close();
if (answer.trim().toLowerCase() !== "yes") {
  console.log("Left alone.");
  process.exit(0);
}

const tx = await db.transaction("write");
try {
  await tx.execute({
    sql: "UPDATE users SET balance = balance + ? WHERE id = ?",
    args: [bet.stake, bet.user_id],
  });
  await tx.execute({
    sql: "UPDATE outcomes SET stake = stake - ? WHERE market_id = ? AND key = ?",
    args: [bet.stake, bet.market_id, bet.pick],
  });
  await tx.execute({
    sql: "DELETE FROM ledger WHERE ref_type = 'bet' AND ref_id = ?",
    args: [betId],
  });
  await tx.execute({ sql: "DELETE FROM events_v2 WHERE bet_id = ?", args: [betId] });
  await tx.execute({ sql: "DELETE FROM bets_v2 WHERE id = ?", args: [betId] });
  await tx.commit();
} catch (e) {
  await tx.rollback().catch(() => {});
  throw e;
} finally {
  tx.close();
}
const after = (await db.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [bet.user_id] })).rows[0];
console.log(`Removed. ${bet.nickname} now has ${after.balance} credits.`);
