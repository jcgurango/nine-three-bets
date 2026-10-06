"use client";

import { useState, useTransition } from "react";
import { placeBetAction } from "@/app/actions";
import { oddsText } from "@/lib/format";
import { quote } from "@/lib/odds";
import { KIND_LABEL, type BetView, type Market, type Match, type Pick } from "@/lib/types";
import { Credits } from "./Credits";
import { LocalTime } from "./LocalTime";

interface Selection {
  marketId: number;
  pick: Pick;
}

const SIDE_TEXT: Record<Pick, string> = { a: "text-val", b: "text-teal" };
const VISIBLE = new Set(["open", "closed", "settled"]);

export function MatchCard({
  match,
  bets,
  balance,
}: {
  match: Match;
  /** The viewer's bets on this match. */
  bets: BetView[];
  /** Null when logged out. */
  balance: number | null;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const markets = match.markets.filter((m) => VISIBLE.has(m.status));
  const maps = [...new Set(markets.map((m) => m.mapNumber))];
  const anyOpen = markets.some((m) => m.status === "open");
  const allSettled = markets.length > 0 && markets.every((m) => m.status === "settled");

  return (
    <article className="overflow-hidden rounded-lg border border-line bg-panel">
      <header className="border-b border-line px-4 py-4">
        <div className="flex flex-wrap items-center gap-x-2 text-xs uppercase tracking-wider text-mute">
          {match.label && <span className="font-semibold text-bone">{match.label}</span>}
          <span>Best of {match.bestOf}</span>
          {match.startsAt != null && <LocalTime ts={match.startsAt} />}
          <span
            className={`ml-auto rounded px-1.5 py-0.5 font-semibold ${
              anyOpen ? "bg-teal/15 text-teal" : "bg-raised text-mute"
            }`}
          >
            {anyOpen ? "Bets open" : allSettled ? "Final" : markets.length ? "Bets closed" : "Soon"}
          </span>
        </div>
        <h3 className="mt-1 flex flex-wrap items-baseline gap-x-3 font-display text-3xl font-bold uppercase leading-tight tracking-wide">
          <span className={SIDE_TEXT.a}>{match.teamA}</span>
          <span className="text-base text-mute">vs</span>
          <span className={SIDE_TEXT.b}>{match.teamB}</span>
        </h3>
      </header>

      {maps.length === 0 && (
        <p className="px-4 py-6 text-sm text-mute">Odds aren&apos;t up yet. Check back soon.</p>
      )}

      {maps.map((mapNumber) => (
        <section key={mapNumber} className="border-b border-line last:border-b-0">
          <h4 className="bg-ink/40 px-4 py-1.5 font-display text-sm font-semibold uppercase tracking-widest text-mute">
            Map {mapNumber}
            {match.mapNames[mapNumber - 1] && (
              <span className="text-bone"> · {match.mapNames[mapNumber - 1]}</span>
            )}
          </h4>
          <div className="divide-y divide-line/50">
            {markets
              .filter((m) => m.mapNumber === mapNumber)
              .map((market) => (
                <MarketRow
                  key={market.id}
                  match={match}
                  market={market}
                  bets={bets.filter((b) => b.marketId === market.id)}
                  balance={balance}
                  pick={selection?.marketId === market.id ? selection.pick : null}
                  onPick={(pick) =>
                    setSelection(
                      selection?.marketId === market.id && selection.pick === pick
                        ? null
                        : { marketId: market.id, pick },
                    )
                  }
                />
              ))}
          </div>
        </section>
      ))}
    </article>
  );
}

function MarketRow({
  match,
  market,
  bets,
  balance,
  pick,
  onPick,
}: {
  match: Match;
  market: Market;
  bets: BetView[];
  balance: number | null;
  pick: Pick | null;
  onPick: (pick: Pick) => void;
}) {
  const qa = quote(market, "a");
  const qb = quote(market, "b");
  if (!qa || !qb) return null;
  const open = market.status === "open";
  const teams: Record<Pick, string> = { a: match.teamA, b: match.teamB };

  return (
    <div className="px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex items-center gap-2 text-sm sm:w-28 sm:flex-col sm:items-start sm:gap-0">
          <span className="font-medium">{KIND_LABEL[market.kind]}</span>
          {!open && (
            <span className="text-xs uppercase tracking-wide text-mute">
              {market.status === "settled" ? "Paid out" : "Closed"}
            </span>
          )}
        </div>
        <div className="grid flex-1 grid-cols-2 gap-2">
          {(["a", "b"] as const).map((side) => {
            const won = market.result === side;
            const lost = market.result != null && !won;
            return (
              <button
                key={side}
                type="button"
                disabled={!open}
                aria-pressed={pick === side}
                onClick={() => onPick(side)}
                className={`flex items-center justify-between gap-2 rounded border px-3 py-2 text-left transition-colors ${
                  pick === side && open
                    ? side === "a"
                      ? "border-val bg-val/15"
                      : "border-teal bg-teal/15"
                    : won
                      ? "border-gold/70 bg-gold/10"
                      : "border-line bg-raised"
                } ${open ? "hover:border-bone/50" : ""} ${lost ? "opacity-40" : ""} ${
                  !open && !won && !lost ? "opacity-60" : ""
                }`}
              >
                <span className="min-w-0 truncate text-sm font-semibold">
                  {teams[side]}
                  {won && <span className="ml-2 text-xs font-bold uppercase text-gold">Won</span>}
                </span>
                <span className="font-mono text-base font-bold tabular-nums">
                  {oddsText((side === "a" ? qa : qb).odds)}
                </span>
              </button>
            );
          })}
          <div
            className="col-span-2 flex h-1 overflow-hidden rounded-full bg-teal/70"
            title={`${Math.round(qa.prob * 100)}% ${match.teamA} / ${Math.round(qb.prob * 100)}% ${match.teamB}`}
          >
            <div className="bg-val/80 transition-[width] duration-500" style={{ width: `${qa.prob * 100}%` }} />
          </div>
        </div>
      </div>

      {open && pick && (
        <BetSlip
          key={pick}
          market={market}
          pick={pick}
          team={teams[pick]}
          balance={balance}
        />
      )}

      {bets.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-mute sm:pl-31">
          {bets.map((b) => (
            <li key={b.id}>
              You: <Credits n={b.stake} className="text-bone" /> on{" "}
              <span className={SIDE_TEXT[b.pick]}>{teams[b.pick]}</span> @ {oddsText(b.odds)}
              {b.status === "pending" && <> → pays <Credits n={b.payout} /></>}
              {b.status === "won" && <span className="text-gold"> · won <Credits n={b.payout} /></span>}
              {b.status === "lost" && <> · lost</>}
              {b.status === "refunded" && <> · refunded</>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CHIPS = [1000, 5000, 10000];

function BetSlip({
  market,
  pick,
  team,
  balance,
}: {
  market: Market;
  pick: Pick;
  team: string;
  balance: number | null;
}) {
  const [stakeText, setStakeText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ stake: number; odds: number; payout: number } | null>(null);
  const [pending, startTransition] = useTransition();

  if (balance == null) {
    return (
      <div className="mt-3 rounded border border-line bg-ink/60 p-3 text-sm sm:ml-31">
        <a href="/api/auth/login" className="font-semibold text-[#8b95ff] hover:underline">
          Log in with Discord
        </a>{" "}
        to bet on {team}. You start with 50,000 credits.
      </div>
    );
  }

  const stake = Number(stakeText) || 0;
  const q = quote(market, pick, stake);
  const tooMuch = stake > balance;
  const setStake = (n: number) => {
    setStakeText(n > 0 ? String(Math.floor(n)) : "");
    setError(null);
    setPlaced(null);
  };

  const submit = () => {
    if (!q || stake < 1 || tooMuch) return;
    startTransition(async () => {
      setError(null);
      setPlaced(null);
      const res = await placeBetAction({ marketId: market.id, pick, stake, quotedOdds: q.odds });
      if (res.ok) {
        setPlaced({ stake, ...res.data });
        setStakeText("");
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <form
      className="mt-3 rounded border border-line bg-ink/60 p-3 sm:ml-31"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`stake-${market.id}`}>
          Stake on {team}
        </label>
        <input
          id={`stake-${market.id}`}
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          placeholder="Stake"
          value={stakeText}
          onChange={(e) => setStake(Number(e.target.value.replace(/\D/g, "").slice(0, 9)))}
          className="w-28 rounded border border-line bg-panel px-2.5 py-1.5 font-mono text-sm tabular-nums outline-none focus:border-bone/60"
        />
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setStake(Math.min(balance, stake + c))}
            className="rounded bg-raised px-2 py-1.5 text-xs font-semibold text-mute hover:text-bone"
          >
            +{c / 1000}k
          </button>
        ))}
        <button
          type="button"
          onClick={() => setStake(balance)}
          className="rounded bg-raised px-2 py-1.5 text-xs font-semibold text-mute hover:text-bone"
        >
          All in
        </button>
        <button
          type="submit"
          disabled={pending || stake < 1 || tooMuch}
          className={`ml-auto rounded px-4 py-1.5 text-sm font-bold text-ink disabled:opacity-40 ${
            pick === "a" ? "bg-val" : "bg-teal"
          }`}
        >
          {pending ? "Placing…" : `Bet on ${team}`}
        </button>
      </div>
      <p className="mt-2 text-xs text-mute" aria-live="polite">
        {error ? (
          <span className="text-val">{error}</span>
        ) : placed ? (
          <span className="text-teal">
            Bet placed: <Credits n={placed.stake} /> on {team} @ {oddsText(placed.odds)}, pays{" "}
            <Credits n={placed.payout} />.
          </span>
        ) : tooMuch ? (
          <span className="text-val">
            You only have <Credits n={balance} />.
          </span>
        ) : stake > 0 && q ? (
          <>
            Your odds for this stake: <b className="text-bone">{oddsText(q.odds)}</b>. Pays{" "}
            <Credits n={q.payout} className="font-bold text-bone" /> if {team} win. Odds lock in when you bet.
          </>
        ) : (
          <>Bigger stakes move the line, so your odds depend on how much you bet.</>
        )}
      </p>
    </form>
  );
}
