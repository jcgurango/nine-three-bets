import { getUser, isAdmin } from "@/lib/auth";
import { marketLabel, outcomeLabel } from "@/lib/outcomes";
import { listAllBets } from "@/lib/store";
import { KIND_LABEL } from "@/lib/types";

const COLUMNS = [
  "bet_id",
  "placed_at",
  "player",
  "match",
  "stage",
  "market",
  "map",
  "pick",
  "stake",
  "odds",
  "payout",
  "status",
];

/** Quote a CSV field: wrap in double quotes when needed, doubling any inside. */
function field(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Every bet by every player as a CSV download, for admins. */
export async function GET() {
  if (!isAdmin(await getUser())) return new Response("Not found", { status: 404 });

  const rows = (await listAllBets()).map((b) => [
    b.id,
    new Date(b.createdAt * 1000).toISOString(),
    b.nickname ?? "(no nickname)",
    `${b.teamA} vs ${b.teamB}`,
    b.label,
    KIND_LABEL[b.kind],
    b.mapNumber === 0 ? "" : marketLabel("map", b.mapNumber, b.mapName).split(" · ")[0],
    outcomeLabel(b.pick, b.teamA, b.teamB),
    b.stake,
    b.odds.toFixed(2),
    // What the bet paid or will pay: the full payout if won or still open, the stake back if voided.
    b.status === "lost" ? 0 : b.status === "refunded" ? b.stake : b.payout,
    b.status === "pending" ? "open" : b.status,
  ]);
  const csv = [COLUMNS, ...rows].map((r) => r.map(field).join(",")).join("\r\n") + "\r\n";

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="9-3-bets-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
