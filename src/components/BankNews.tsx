"use client";

import { useSyncExternalStore } from "react";
import { BAILOUT } from "@/lib/types";
import { Credits } from "./Credits";

const KEY = "bank-news-dismissed";
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const unread = () => {
  try {
    return localStorage.getItem(KEY) == null;
  } catch {
    return true;
  }
};
const dismiss = () => {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {}
  listeners.forEach((fn) => fn());
};

/**
 * The front page the morning after the Bank of 9-3 went down. Shown once the
 * bank is shut down, in the loan desk's spot; closing it is remembered on the
 * device so it's only ever read once.
 */
export function BankNews() {
  // Hidden on the server and until hydration, so a dismissed story never flashes.
  const shown = useSyncExternalStore(subscribe, unread, () => false);
  if (!shown) return null;

  return (
    <article className="relative rounded-sm bg-[#efe6cf] px-5 py-4 font-serif text-[#1b1710] shadow-[0_2px_0_#d8ccae,0_8px_18px_rgb(0_0_0/0.45)]">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-2 right-2 h-6 w-6 rounded-full text-base leading-none text-[#1b1710]/50 hover:bg-[#1b1710]/10 hover:text-[#1b1710]"
      >
        ×
      </button>
      <p className="border-b-2 border-[#1b1710] pb-1 text-center text-[10px] font-bold uppercase tracking-[0.3em]">
        The 9-3 Gazette
      </p>
      <p className="mt-1 flex justify-between text-[9px] uppercase tracking-widest text-[#1b1710]/60">
        <span>Late edition</span>
        <span>Front page</span>
      </p>
      <h2 className="mt-2 text-xl leading-tight font-black tracking-tight">
        Bank of 9-3 Truck Caught Smuggling Drugs, Cash; Usury Probe Underway
      </h2>
      <div className="mt-3 space-y-2 border-t border-[#1b1710]/30 pt-2 text-[13px] leading-snug">
        <p>
          <span className="float-left mt-0.5 mr-1 text-3xl leading-[0.8] font-black">A</span>
          truck belonging to the <i>Bank of 9-3</i> was intercepted carrying cocaine and fentanyl, along with several
          hundred thousand credits, authorities said.
        </p>
        <p>
          Following the seizure, officials announced that every resident is entitled to{" "}
          <b>
            <Credits n={BAILOUT} />
          </b>{" "}
          after debts are settled, as the recovered funds may be used to credit other loanees.
        </p>
        <p>
          The bank&apos;s troubles may not end there. VALORANT group has confirmed it is also investigating the Bank
          of 9-3 on suspicion of usury.
        </p>
      </div>
      <p className="mt-3 border-t border-[#1b1710]/30 pt-1.5 text-[10px] text-[#1b1710]/60">
        Check your credit history on the bets page for what you got back.
      </p>
    </article>
  );
}
