import Link from "next/link";
import { getUser, isAdmin } from "@/lib/auth";
import { Balance } from "./Balance";
import { NicknameButton } from "./Nickname";

export async function Header() {
  const user = await getUser();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ink/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 whitespace-nowrap px-4">
        <Link href="/" className="font-display text-xl font-bold uppercase tracking-wide sm:text-2xl">
          <span className="text-val">9-3</span> Bets
        </Link>
        <nav className="ml-auto flex items-center gap-2.5 text-sm sm:gap-3">
          {user ? (
            <>
              {isAdmin(user) && (
                <Link href="/admin" className="text-gold hover:underline">
                  Admin
                </Link>
              )}
              <Link href="/bets" className="text-mute hover:text-bone">
                My bets
              </Link>
              <Balance value={user.balance} />
              {user.nickname && (
                <NicknameButton nickname={user.nickname} avatarUrl={user.avatarUrl} />
              )}
              <form action="/api/auth/logout" method="post">
                <button className="text-mute hover:text-bone">Log out</button>
              </form>
            </>
          ) : (
            <LoginButton />
          )}
        </nav>
      </div>
    </header>
  );
}

export function LoginButton({ className = "" }: { className?: string }) {
  return (
    <a
      href="/api/auth/login"
      className={`rounded bg-[#5865f2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#4752c4] ${className}`}
    >
      Log in with Discord
    </a>
  );
}
