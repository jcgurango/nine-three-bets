import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Credits } from "@/components/Credits";
import { LocalTime } from "@/components/LocalTime";
import { getUser } from "@/lib/auth";
import { oddsText } from "@/lib/format";
import { listLedger, listUserBets } from "@/lib/store";
import { marketLabel, outcomeLabel, outcomeSide } from "@/lib/outcomes";
import type { BetStatus, BetView, LedgerEntry, LedgerKind } from "@/lib/types";

const STATUS: Record<BetStatus, { label: string; className: string }> = {
  pending: { label: "Open", className: "text-bone" },
  won: { label: "Won", className: "text-gold" },
  lost: { label: "Lost", className: "text-mute" },
  refunded: { label: "Refunded", className: "text-mute" },
};

export default async function BetsPage() {
  const user = await getUser();
  if (!user) redirect("/");
  const [bets, ledger] = await Promise.all([listUserBets(user.id), listLedger(user.id)]);
  const open = bets.filter((b) => b.status === "pending");
  const done = bets.filter((b) => b.status !== "pending");

  return (
    <div className="space-y-8">
      <AutoRefresh ms={10000} />
      <BetTable title="Open bets" bets={open} empty="No open bets. Go find a line you like." />
      <BetTable title="Settled" bets={done} empty="Nothing settled yet." />
      <CreditHistory entries={ledger} debt={user.debt} />
    </div>
  );
}

const KIND_TEXT: Record<LedgerKind, string> = {
  signup: "Welcome credits",
  bet: "Bet placed",
  payout: "Bet won",
  refund: "Bet refunded",
  reversal: "Result corrected",
  loan: "Loan taken",
  repayment: "Loan repaid",
  garnish: "Taken for your loan",
  garnish_reversal: "Loan deduction returned",
  interest: "Loan interest",
  stipend: "Match stipend",
  clawback: "Stipend taken back (not bet or repaid)",
  clawback_reversal: "Stipend returned",
  adjustment: "Adjustment",
};

/** Every credit movement that wasn't just a bet, so loans, stipends and deductions are explained. */
function CreditHistory({ entries, debt }: { entries: LedgerEntry[]; debt: number }) {
  const shown = entries.filter((e) => e.kind !== "bet");
  return (
    <section>
      <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide">Credit history</h2>
      {debt > 0 && (
        <p className="mb-3 text-sm text-val">
          You currently owe <Credits n={debt} /> on your loan.
        </p>
      )}
      {shown.length === 0 ? (
        <p className="rounded-lg border border-line bg-panel px-4 py-6 text-sm text-mute">Nothing here yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full min-w-md text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-mute">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">What</th>
                <th className="px-4 py-2 text-right font-medium">Credits</th>
                <th className="px-4 py-2 text-right font-medium">Owed</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} className="border-b border-line/50 last:border-b-0">
                  <td className="px-4 py-2 text-xs text-mute">
                    <LocalTime ts={e.createdAt} />
                  </td>
                  <td className="px-4 py-2">
                    {KIND_TEXT[e.kind] ?? e.kind}
                    {e.note && <span className="text-xs text-mute"> · {e.note}</span>}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono tabular-nums ${e.amount < 0 ? "text-val" : e.amount > 0 ? "text-teal" : "text-mute"}`}>
                    {e.amount === 0 ? "–" : <>{e.amount < 0 ? "\u2212" : "+"}<Credits n={Math.abs(e.amount)} /></>}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono tabular-nums ${e.debtDelta > 0 ? "text-val" : "text-mute"}`}>
                    {e.debtDelta === 0 ? "" : <>{e.debtDelta < 0 ? "\u2212" : "+"}<Credits n={Math.abs(e.debtDelta)} /></>}
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
                    <span className={outcomeSide(b.pick) === "a" ? "text-val" : "text-teal"}>
                      {outcomeLabel(b.pick, b.teamA, b.teamB)}
                    </span>
                    <div className="text-xs text-mute">
                      {marketLabel(b.kind, b.mapNumber, b.mapName)}
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
