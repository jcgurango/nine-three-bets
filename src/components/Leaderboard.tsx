import type { LeaderboardRow } from "@/lib/types";
import { Avatar } from "./Avatar";
import { Credits } from "./Credits";

export function Leaderboard({ rows, meId }: { rows: LeaderboardRow[]; meId: string | null }) {
  return (
    <section className="rounded-lg border border-line bg-panel">
      <h2 className="border-b border-line px-4 py-3 font-display text-xl font-bold uppercase tracking-wide">
        Leaderboard
      </h2>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-mute">Nobody has signed up yet. Be the first.</p>
      ) : (
        <ol>
          {rows.map((r, i) => (
            <li
              key={r.id}
              className={`flex items-center gap-3 border-b border-line/60 px-4 py-2.5 last:border-b-0 ${
                r.id === meId ? "bg-raised" : ""
              }`}
            >
              <span
                className={`w-5 text-right font-display text-lg font-bold tabular-nums ${
                  i === 0 ? "text-gold" : "text-mute"
                }`}
              >
                {i + 1}
              </span>
              <Avatar url={r.avatarUrl} name={r.displayName} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.displayName}</span>
                <span className="block text-xs text-mute">
                  {r.wins}W {r.losses}L
                  {r.inPlay > 0 && <> · <Credits n={r.inPlay} /> in play</>}
                  {r.borrowed > 0 && (
                    <span className="text-val">
                      {" "}
                      · borrowed <Credits n={r.borrowed} />
                    </span>
                  )}
                  {r.debt > 0 && (
                    <span className="text-val">
                      {" "}
                      · owes <Credits n={r.debt} />
                    </span>
                  )}
                </span>
              </span>
              <span
                className={`font-mono text-sm font-semibold tabular-nums ${
                  r.balance + r.inPlay - r.debt < 0 ? "text-val" : ""
                }`}
              >
                {r.balance + r.inPlay - r.debt < 0 && "\u2212"}
                <Credits n={Math.abs(r.balance + r.inPlay - r.debt)} />
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="border-t border-line px-4 py-2 text-xs text-mute">
        Ranked by credits plus open stakes, minus anything owed on loans.
      </p>
    </section>
  );
}
