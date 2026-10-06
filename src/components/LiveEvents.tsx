"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { showBalanceDelta } from "@/lib/delta";
import { KIND_LABEL, type LiveEvent } from "@/lib/types";
import { Credits } from "./Credits";
import { LoseAnimation, type Loss } from "./LoseAnimation";
import { WinCelebration, type Win } from "./WinCelebration";

interface Toast {
  id: number;
  tone: "win" | "loss" | "neutral";
  title: string;
  /** Shown after the title with the credits icon. */
  amount?: number;
  body: string;
}

const TOAST_MS = 9000;
/** Results that arrive this close together (e.g. one payout settling several bets) are shown as one. */
const BATCH_MS = 350;
const MUTE_KEY = "93:muted";

const describe = (e: LiveEvent) =>
  `${e.team} · Map ${e.mapNumber}${e.mapName ? ` (${e.mapName})` : ""} ${KIND_LABEL[e.marketKind].toLowerCase()}`;

const sum = (events: LiveEvent[]) => events.reduce((n, e) => n + e.amount, 0);

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Listens for the player's bet results and turns them into balance floats,
 * toasts and a full-screen moment: the celebration for wins, the sad trumpet
 * for losses.
 */
export function LiveEvents({ userId }: { userId: string }) {
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [win, setWin] = useState<Win | null>(null);
  const [loss, setLoss] = useState<Loss | null>(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const cursorKey = `93:last-event:${userId}`;
    const remember = (id: string) => {
      try {
        if (id) localStorage.setItem(cursorKey, id);
      } catch {}
    };
    let after: string | null = null;
    try {
      after = localStorage.getItem(cursorKey);
    } catch {}

    let nextToastId = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };

    const toast = (t: Omit<Toast, "id">) => {
      const id = ++nextToastId;
      setToasts((list) => [...list.slice(-3), { ...t, id }]);
      later(() => setToasts((list) => list.filter((x) => x.id !== id)), TOAST_MS);
    };

    const handle = (batch: LiveEvent[]) => {
      router.refresh();
      const of = (kind: LiveEvent["kind"]) => batch.filter((e) => e.kind === kind);
      const won = of("won");
      const lost = of("lost");
      const refunded = of("refunded");
      const reversed = of("reversed");
      const many = (events: LiveEvent[], noun: string) =>
        events.length === 1 ? describe(events[0]) : `${events.length} ${noun}`;

      if (won.length) {
        const amount = sum(won);
        showBalanceDelta(amount);
        toast({
          tone: "win",
          title: won.length === 1 ? "You won" : `${won.length} bets won`,
          amount,
          body: many(won, "bets paid out"),
        });
        setMuted(readMuted());
        setLoss(null);
        setWin({
          key: won[won.length - 1].id,
          amount,
          subtitle: many(won, "winning bets"),
          bestOdds: Math.max(...won.map((e) => e.odds)),
        });
      }
      if (lost.length) {
        const amount = sum(lost);
        showBalanceDelta(amount);
        toast({
          tone: "loss",
          title: lost.length === 1 ? "You lost" : `${lost.length} bets lost`,
          amount: -amount,
          body: many(lost, "bets didn't land"),
        });
        // A win in the same batch gets the stage to itself.
        if (!won.length) {
          setMuted(readMuted());
          setWin(null);
          setLoss({
            key: lost[lost.length - 1].id,
            amount: -amount,
            subtitle: many(lost, "losing bets"),
            shortestOdds: Math.min(...lost.map((e) => e.odds)),
          });
        }
      }
      if (refunded.length) {
        const amount = sum(refunded);
        showBalanceDelta(amount);
        toast({
          tone: "neutral",
          title: refunded.length === 1 ? "Bet refunded" : `${refunded.length} bets refunded`,
          amount,
          body: many(refunded, "bets voided, stakes returned"),
        });
      }
      if (reversed.length) {
        showBalanceDelta(sum(reversed));
        toast({
          tone: "neutral",
          title: "Result corrected",
          body:
            reversed.length === 1
              ? `Your bet on ${describe(reversed[0])} is back in play.`
              : `${reversed.length} of your bets are back in play.`,
        });
      }
    };

    let queue: LiveEvent[] = [];
    let flush: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource(`/api/events${after ? `?after=${encodeURIComponent(after)}` : ""}`);
    source.addEventListener("hello", (e) => remember((e as MessageEvent).lastEventId));
    source.addEventListener("bet", (e) => {
      const message = e as MessageEvent<string>;
      remember(message.lastEventId);
      queue.push(JSON.parse(message.data) as LiveEvent);
      clearTimeout(flush);
      flush = setTimeout(() => {
        const batch = queue;
        queue = [];
        handle(batch);
      }, BATCH_MS);
    });

    return () => {
      source.close();
      clearTimeout(flush);
      timers.forEach(clearTimeout);
    };
  }, [userId, router]);

  const clearWin = useCallback(() => setWin(null), []);
  const clearLoss = useCallback(() => setLoss(null), []);

  const toggleMuted = () => {
    const next = !muted;
    setMuted(next);
    try {
      localStorage.setItem(MUTE_KEY, next ? "1" : "0");
    } catch {}
  };

  return (
    <>
      {win && <WinCelebration key={win.key} win={win} muted={muted} onDone={clearWin} />}
      {loss && <LoseAnimation key={loss.key} loss={loss} muted={muted} onDone={clearLoss} />}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast pointer-events-auto rounded-lg border border-l-4 bg-panel p-3 shadow-xl shadow-black/40 ${
              t.tone === "win"
                ? "border-gold/60 border-l-gold"
                : t.tone === "loss"
                  ? "border-line border-l-val"
                  : "border-line border-l-mute"
            }`}
          >
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 font-semibold">
                {t.title}
                {t.amount != null && (
                  <>
                    {" "}
                    <Credits n={t.amount} className={t.tone === "win" ? "text-gold" : ""} />
                  </>
                )}
              </p>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
                className="-mr-1 -mt-1 px-1 text-lg leading-none text-mute hover:text-bone"
              >
                ×
              </button>
            </div>
            <p className="mt-0.5 text-sm text-mute">{t.body}</p>
            <p className="mt-2 flex items-center justify-between text-sm">
              <Link href="/bets" className="font-semibold text-bone underline-offset-2 hover:underline">
                Go to your bets →
              </Link>
              {t.tone !== "neutral" && (
                <button type="button" onClick={toggleMuted} className="text-xs text-mute hover:text-bone">
                  {muted ? "Turn sounds on" : "Mute sounds"}
                </button>
              )}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}
