import { AutoRefresh } from "@/components/AutoRefresh";
import { LoginButton } from "@/components/Header";
import { Leaderboard } from "@/components/Leaderboard";
import { MatchCard } from "@/components/MatchCard";
import { getUser } from "@/lib/auth";
import { getLeaderboard, listMatches, listUserBets } from "@/lib/store";

export default async function Home({ searchParams }: PageProps<"/">) {
  const user = await getUser();
  const [matches, leaderboard, bets, params] = await Promise.all([
    listMatches(false),
    getLeaderboard(),
    user ? listUserBets(user.id) : [],
    searchParams,
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <AutoRefresh />
      <div className="space-y-6">
        {params.login === "failed" && (
          <p className="rounded border border-val/50 bg-val/10 px-4 py-3 text-sm">
            Discord login didn&apos;t go through. Try again.
          </p>
        )}
        {!user && (
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-panel px-4 py-4">
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-display text-xl font-bold uppercase tracking-wide">
                Nobody&apos;s safe at <span className="text-val">9-3</span>.
              </span>
              <br />
              <span className="text-mute">
                Log in to get 50,000 play-money credits and bet on every map and pistol round.
              </span>
            </p>
            <LoginButton />
          </div>
        )}
        <h2 className="font-display text-xl font-bold uppercase tracking-wide">
          {matches.length > 1 ? "Upcoming matches" : "Upcoming match"}
        </h2>
        {matches.length === 0 && (
          <p className="rounded-lg border border-line bg-panel px-4 py-8 text-center text-sm text-mute">
            No matches on the board right now. Check back soon.
          </p>
        )}
        {matches.map((match) => (
          <MatchCard
            key={match.id}
            match={match}
            bets={bets.filter((b) => b.matchId === match.id)}
            balance={user ? user.balance : null}
          />
        ))}
      </div>
      <aside>
        <Leaderboard rows={leaderboard} meId={user?.id ?? null} />
      </aside>
    </div>
  );
}
