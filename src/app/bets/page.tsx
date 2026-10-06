import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Credits } from "@/components/Credits";
import { LocalTime } from "@/components/LocalTime";
import { getUser } from "@/lib/auth";
import { oddsText } from "@/lib/format";
import { listUserBets } from "@/lib/store";
import { KIND_LABEL, type BetStatus, type BetView } from "@/lib/types";

const STATUS: Record<BetStatus, { label: string; className: string }> = {
  pending: { label: "Open", className: "text-bone" },
  won: { label: "Won", className: "text-gold" },
  lost: { label: "Lost", className: "text-mute" },
  refunded: { label: "Refunded", className: "text-mute" },
};

export default async function BetsPage() {
  const user = await getUser();
  if (!user) redirect("/");
  const bets = await listUserBets(user.id);
  const open = bets.filter((b) => b.status === "pending");
  const done = bets.filter((b) => b.status !== "pending");

  return (
    <div className="space-y-8">
      <AutoRefresh ms={10000} />
      <BetTable title="Open bets" bets={open} empty="No open bets. Go find a line you like." />
      <BetTable title="Settled" bets={done} empty="Nothing settled yet." />
    </div>
  );
}

function BetTable({ title, bets, empty }: { title: string; bets: BetView[]; empty: string }) {
  return (
    <section>
      <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide">{title}</h2>
      {bets.length === 0 ? (
        <p className="rounded-lg border border-line bg-panel px-4 py-6 text-sm text-mute">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full min-w-xl text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-mute">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Match</th>
                <th className="px-4 py-2 font-medium">Bet</th>
                <th className="px-4 py-2 text-right font-medium">Stake</th>
                <th className="px-4 py-2 text-right font-medium">Odds</th>
                <th className="px-4 py-2 text-right font-medium">Payout</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {bets.map((b) => (
                <tr key={b.id} className="border-b border-line/50 last:border-b-0">
                  <td className="px-4 py-2">
                    {b.teamA} vs {b.teamB}
                    <div className="text-xs text-mute">
                      <LocalTime ts={b.createdAt} />
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <span className={b.pick === "a" ? "text-val" : "text-teal"}>
                      {b.pick === "a" ? b.teamA : b.teamB}
                    </span>
                    <div className="text-xs text-mute">
                      Map {b.mapNumber}
                      {b.mapName && ` (${b.mapName})`} · {KIND_LABEL[b.kind]}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                    <Credits n={b.stake} />
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{oddsText(b.odds)}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                    <Credits n={b.status === "lost" ? 0 : b.status === "refunded" ? b.stake : b.payout} />
                  </td>
                  <td className={`px-4 py-2 font-semibold ${STATUS[b.status].className}`}>
                    {STATUS[b.status].label}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
