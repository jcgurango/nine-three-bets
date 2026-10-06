# 9-3 Bets

Play-money betting on Valorant matches. Players log in with Discord, pick a
nickname, start with 50,000 credits, and bet on the winner of each map and of
the 1st and 2nd pistol rounds. Next.js (App Router) + SQLite via libSQL.

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

Tables are created automatically on first start.

## Running a match (`/admin`)

1. **Add the match**: teams, stage, format and start time. Several matches can
   be active at once. Each map gets three markets: map winner, 1st pistol and
   2nd pistol.
2. **Enter odds**: decimal odds for both teams from your external source, per
   market. Update them whenever the outside line moves.
3. **Open** markets one at a time, per map, or all at once. Markets without odds
   stay in draft and are hidden from players.
4. **Close** each market when its map or round starts.
5. **Pay out** by clicking the winner (asks for a second click). **Void**
   refunds every stake, for example on a map 3 that is never played. Both can be
   undone.
6. **Archive** the match to take it off the home page.

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

The price of each side is a blend, set in `src/lib/odds.ts`:

- `PROVIDED_WEIGHT` (0.5): half comes from the admin-entered odds, with the
  bookmaker margin normalized out, and half from the share of credits users have
  staked on each side.
- `POOL_SEED` (50,000): virtual credits placed in each pool at the provided
  odds, so early bets nudge the line instead of swinging it. Lower it to make
  user bets move the line faster.

A bet's odds are fixed when it is placed and are the odds *after* its own stake
is counted, so a large bet gets a slightly worse price than the one displayed.
That also means nobody can move the line with one bet and take the other side
for a guaranteed profit. If the price worsens by more than 3% between a player
seeing it and the bet arriving, the bet is rejected and they are shown the new
odds.
