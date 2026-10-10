# 9-3 Bets

Play-money betting on Valorant matches. Players log in with Discord, pick a
nickname, start with 50,000 credits, and bet on the match winner, the correct
map score, and the winner of each map and of its 1st and 2nd pistol rounds.
Next.js (App Router) + SQLite via libSQL.

Only nicknames are shown on the site. Discord names are stored but never
displayed, and players without a nickname don't appear on the leaderboard.
Players can rename themselves by clicking their name in the header.

## Run locally

```bash
cp .env.example .env.local   # then fill it in
npm install
npm run dev
```

To skip Discord while developing, set `DEV_LOGIN=1` and open
`/api/auth/dev?as=alice`. That signs you in as the user `dev-alice`; add
`dev-<name>` to `ADMIN_DISCORD_IDS` to make that user an admin. The route is
disabled in production builds.

The local database is the file `data/ninethree.db`. Delete the `data/` folder
(with the server stopped) to start from scratch.

## Configuration

| Variable | What it is |
| --- | --- |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | From your application at <https://discord.com/developers/applications> (OAuth2 page). Add `<APP_URL>/api/auth/callback` as a redirect URI there. |
| `APP_URL` | Public URL of the site, no trailing slash. |
| `SESSION_SECRET` | Long random string that signs login cookies (`openssl rand -hex 32`). Required in production. |
| `ADMIN_DISCORD_IDS` | Comma-separated Discord user IDs allowed to open `/admin`. |
| `DATABASE_URL`, `DATABASE_AUTH_TOKEN` | Optional. Defaults to `file:./data/ninethree.db`. Set to a `libsql://` URL and token to use a hosted Turso database. |

## Deploying

- **A server or container with a persistent disk** (VPS, Fly.io, Railway, Render):
  `npm run build && npm start`, keeping the default SQLite file on the disk. Run
  a single instance: writes are queued in-process.
- **Vercel or other serverless hosts**: the filesystem doesn't persist, so point
  `DATABASE_URL` at a hosted libSQL database (Turso).

Tables are created automatically on first start, and an older database is
upgraded in place. The upgrade that added multi-outcome markets copied
`markets`, `bets` and `events` into `markets_v2` + `outcomes`, `bets_v2` and
`events_v2`; the original three tables are no longer read and are kept only as a
backup.

## Running a match (`/admin`)

While a match is on, the **Next up** bar at the top of it offers the one
action that comes next in the order of play: open the first maps (two for a
best of 3, three for a best of 5) along with the match winner and correct
score, then for each map close and settle the 1st pistol, the 2nd pistol and
the map winner, opening the decider when it's reached. Anything already handled, voided or never opened in the full controls
below is skipped. The bar disappears once a team has won the series.


1. **Add the match**: teams, stage, format and start time. Several matches can
   be active at once. A best of 3 or 5 gets two markets on the full match:
   match winner, and correct score (2:0, 2:1, 1:2, 0:2, or the six scores of a
   best of 5). Each map gets three more: map winner, 1st pistol and 2nd pistol.
   A best of 1 has only the map markets.
2. **Enter odds**: decimal odds for every outcome from your external source, per
   market. Update them whenever the outside line moves.
3. **Open** markets one at a time, per map, or all at once. Markets without odds
   stay in draft and are hidden from players.
4. **Close** each market when its map or round starts, and the full-match
   markets when the match starts.
5. **Pay out** by clicking **Won** next to the result (asks for a second
   click). Map results drive the full-match markets: once a map is paid out,
   correct scores that can no longer happen come off the board and bets on
   them lose, and when the series is decided the correct score and match
   winner are paid out automatically (marked "automatic" in admin). Pistol
   markets are always paid out by hand. **Void** refunds every stake, for
   example on a map 3 that is never played.
6. **Undo** reverses a payout or void. Undoing a map result also brings back
   the scores it ruled out and reopens anything it paid out automatically; those
   markets come back closed, so reopen them if betting should continue.
7. **Archive** the match to take it off the home page.

## House rules: exposure cap, stipends and loans

Every credit movement is recorded in the `ledger` table (sign-up credits,
stakes, payouts, refunds, corrections, loans, interest, garnishing, stipends
and claw-backs), and a player's balance and debt are always the sum of their
entries. Players see theirs under "Credit history" on the bets page. The
numbers below are editable under **House rules** in admin; defaults in
brackets.

- **Exposure cap** (25%): a player's open stakes may be at most this share of
  their bankroll (credits plus open stakes). The bet slip's "Max" is what they
  can still stake.
- **Minimum odds** (1.20, fixed in `src/lib/odds.ts`): outcomes priced shorter
  than this are shown but can't be bet on.
- **Stipend** (5,000): when betting first opens on a match, every player
  registered at that moment gets it. Players who join later don't. A stake
  (won, lost or open; refunded bets don't count) or a loan repayment covers
  stipends the player had already received when they made it, oldest first;
  taking a new loan cancels repayment credit again, so only debt paid down for
  good counts. When a match is finalized, whatever its stipend is still
  uncovered is clawed back, even if that takes the player negative. So two
  stipends can go on one match, a player who bets 3,000 of 10,000 keeps
  exactly 3,000, and bets made before a stipend arrived never excuse it. A
  stipend that has been clawed back counts as spent, so it can't soak up
  later stakes meant for the next match.
- **Repossession**: a claw-back from a player with a loan pays the loan down
  first; only what's left over past the debt is plain claw-back. The player's
  credits drop by the same amount either way, but a 5,000 claw-back against a
  6,000 debt leaves them owing 1,000, and the per-match interest is charged on
  what remains after that.
- **Loans**: a player holding under 5,000 credits can borrow, as long as what
  they'd owe stays within 20,000. Interest of 5% is added up front, rounded
  up, so a fresh borrower can take at most 19,047. Another 5% is added to all
  outstanding debt every time a match is finalized. 25% of each winning bet's
  profit (rounded up) is taken towards the debt at payout, and returned if the
  payout is undone. Players can also pay back any amount. The leaderboard ranks
  by credits plus open stakes minus debt, and shows what each player owes and
  everything they've ever borrowed.
- **Finalize** (admin, per match, once every market with bets is paid out or
  voided): voids leftover markets nobody bet on, claws back stipend money
  that wasn't bet (paying down loans first) and charges the per-match
  interest. It can be undone, which returns the claw-backs, restores any debt
  they paid down and removes that interest.

## Scraped odds (`POST /ingest`)

Instead of typing odds in, a scraper can post them. The request must carry the
session cookie of a logged-in admin, and the body is one scraped match (or an
array of them):

```json
{
  "scrapedAt": "2026-10-06T20:44:43.135Z",
  "matchId": "5:a55be1bd-4c78-4630-83d9-16c81d2adcb6",
  "tournament": "VALORANT Champions 2026",
  "teams": ["100 Thieves", "G2 Esports"],
  "markets": {
    "Winner": { "100 Thieves": 1.51, "G2 Esports": 2.46 },
    "Map 1 - Winner (incl. overtime)": { "100 Thieves": 1.6, "G2 Esports": 2.24 },
    "Correct map score": { "2:0": 2.58, "2:1": 3.2, "0:2": 4.72, "1:2": 4.27 },
    "Map 1 - Pistol round winner": {
      "100 Thieves 1st": 1.79, "100 Thieves 2nd": 1.79,
      "G2 Esports 1st": 1.96, "G2 Esports 2nd": 1.96
    }
  }
}
```

**Which match.** A match is recognised by `matchId` once it has been seen,
as long as it isn't archived: archived matches are never updated, whatever
the id. Otherwise it is matched to an active match by team names, in either
order;
"G2" matches "G2 Esports" and "100T" matches "100 Thieves", but abbreviations
like "FNC" for "Fnatic" do not. If nothing fits, a new match is created from
the scraped teams and tournament, with its length taken from the scores on
offer and every market left in draft.

**Which market.** Titles are matched loosely (case, dashes and bracketed notes
are ignored):

| Scraped title | Goes to |
| --- | --- |
| `Winner`, `Match winner` | Match winner |
| `Map N - Winner ...` | Map N: map winner |
| `Correct map score`, `Correct score` | Correct score. Scores are read as first team : second team. |
| `Map N - Pistol round winner` with outcomes `<team> 1st` / `<team> 2nd` | Map N: 1st pistol and 2nd pistol |
| `Map N - 1st pistol ...`, `Map N - 2nd pistol ...` | Map N: that pistol round |

Anything else is skipped, as is a market missing an outcome, one that doesn't
fit the match (map 4 of a best of 3), or one already paid out or voided. The
response lists what was applied and what was skipped, with the reason.

Ingesting only sets the provided odds: it never opens, closes or pays out a
market, and it overwrites odds typed in by hand. A scrape older than the last
one applied to the match is rejected.

The session cookie is `SameSite=Lax`, so the request has to come from something
that sends it: a page on this site, a browser extension with permission for
this site, or a script that passes the cookie itself. A `fetch` run inside the
bookmaker's page will arrive without it and get a 401.

The scraper script for GGBet is at scraper.js - use it with greasemonkey et al.

## Live results

Each logged-in browser holds a server-sent events connection to `/api/events`.
When a market is paid out, voided or corrected, affected players get a toast
and a `+`/`-` amount next to their balance. Winners get the celebration with
`public/winner.mp3`; losers get the sad trumpet, `public/loser.mp3`. Sounds can
be muted from either toast. Results that land while
a player is away are shown the next time they open the site on that device.

Delivery is instant on a single server. With several instances, or on
serverless hosts, each connection also checks the database every 5 seconds, so
results arrive within that window.

## How odds work

Prices come from the provided odds with the bookmaker margin normalized out,
so the implied probabilities of a market's outcomes add up to 1. Two constants
in `src/lib/odds.ts` control whether user bets also move the line:

- `PROVIDED_WEIGHT` (currently 1): the share of the price that comes from the
  provided odds. At 1, user bets don't move the line at all. At 0.5, half the
  price comes from the share of credits users have staked on each outcome.
- `POOL_SEED` (50,000): only used when `PROVIDED_WEIGHT` is below 1. Virtual
  credits placed in each pool at the provided odds, so early bets nudge the
  line instead of swinging it.

Changing these only affects prices quoted from then on: every bet keeps the
odds and payout it was placed at.

A bet's odds are fixed when it is placed. When user bets move the line, a bet
is priced at the odds *after* its own stake is counted, so a large bet gets a
slightly worse price than the one displayed and nobody can move the line with
one bet and back the other outcomes for a guaranteed profit. If the price
worsens by more than 3% between a player seeing it and the bet arriving, the
bet is rejected and they are shown the new odds.
