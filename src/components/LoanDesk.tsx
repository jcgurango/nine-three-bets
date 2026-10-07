"use client";

import { useState, useTransition } from "react";
import { repayLoanAction, takeLoanAction } from "@/app/actions";
import { credits } from "@/lib/format";
import type { LoanOffer } from "@/lib/store";
import { Credits } from "./Credits";

const digits = (s: string) => Number(s.replace(/\D/g, "").slice(0, 9)) || 0;

/**
 * The back-alley lender. Offers a loan to anyone broke enough, and shows what
 * a borrower owes with a way to pay it down. The copy is meant to look shady.
 */
export function LoanDesk({
  balance,
  debt,
  borrowed,
  offer,
}: {
  balance: number;
  debt: number;
  borrowed: number;
  offer: LoanOffer;
}) {
  const [amount, setAmount] = useState(String(Math.min(offer.max, 5000)));
  const [repay, setRepay] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const want = digits(amount);
  const owedFor = (n: number) => n + Math.ceil((n * offer.interestPct) / 100 - 1e-9);

  const borrow = () =>
    startTransition(async () => {
      setMessage(null);
      const res = await takeLoanAction(want);
      if (res.ok) setMessage({ tone: "ok", text: `Pleasure doing business. That's another ${credits(res.data.owed)} on your tab. Don't forget.` });
      else setMessage({ tone: "bad", text: res.error });
    });
  const payBack = (n: number) =>
    startTransition(async () => {
      setMessage(null);
      const res = await repayLoanAction(n);
      if (res.ok) {
        setRepay("");
        setMessage({ tone: "ok", text: n >= debt ? "Paid in full. We'll be here when you need us again." : "Received. Keep it coming." });
      } else setMessage({ tone: "bad", text: res.error });
    });

  return (
    <section className="loan-desk rounded-lg border-2 border-dashed border-gold bg-[#1a1407] p-4 text-sm">
      <h2 className="font-display text-2xl font-bold uppercase leading-none tracking-wide text-gold">
        <span className="loan-blink">💸</span> 9-3 Payday Loans
      </h2>
      <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-gold/80">
        No credit check · No questions · Instant approval*
      </p>

      {offer.eligible && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            borrow();
          }}
        >
          <p>
            Down to <Credits n={balance} />? Rough. Your friends at the Bank of 9-3 can spot you up to{" "}
            <b className="text-gold">
              <Credits n={offer.max} />
            </b>{" "}
            <i>right now</i>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              inputMode="numeric"
              aria-label="Amount to borrow"
              value={amount}
              onChange={(e) => setAmount(String(digits(e.target.value)))}
              className="w-28 rounded border border-gold/50 bg-ink px-2.5 py-1.5 font-mono tabular-nums outline-none focus:border-gold"
            />
            {[5000, 10000].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setAmount(String(Math.min(offer.max, n)))}
                className="rounded bg-gold/15 px-2 py-1.5 text-xs font-semibold text-gold hover:bg-gold/25"
              >
                {n / 1000}k
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAmount(String(offer.max))}
              className="rounded bg-gold/15 px-2 py-1.5 text-xs font-semibold text-gold hover:bg-gold/25"
            >
              Max
            </button>
          </div>
          <button
            type="submit"
            disabled={pending || want < 1 || want > offer.max}
            className="loan-button w-full rounded bg-gold px-4 py-2 font-display text-xl font-bold uppercase tracking-wide text-ink disabled:opacity-40"
          >
            {pending ? "Counting it out…" : "Take the money"}
          </button>
          {want > 0 && want <= offer.max && (
            <p className="text-xs text-gold/80">
              Borrow <Credits n={want} />, owe <Credits n={owedFor(want)} />. Easy.
            </p>
          )}
        </form>
      )}

      {debt > 0 && (
        <form
          className="mt-3 space-y-2 border-t border-gold/30 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            payBack(digits(repay));
          }}
        >
          <p>
            You owe <b className="text-val"><Credits n={debt} /></b>
            {borrowed > debt && (
              <span className="text-mute">
                {" "}
                (borrowed <Credits n={borrowed} /> all told)
              </span>
            )}
            . {offer.garnishPct}% of every win comes to us until you&apos;re square.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              inputMode="numeric"
              aria-label="Amount to pay back"
              placeholder="Pay back"
              value={repay}
              onChange={(e) => setRepay(e.target.value.replace(/\D/g, "").slice(0, 9))}
              className="w-28 rounded border border-line bg-ink px-2.5 py-1.5 font-mono tabular-nums outline-none focus:border-bone/60"
            />
            <button
              type="submit"
              disabled={pending || digits(repay) < 1}
              className="rounded border border-line bg-raised px-3 py-1.5 text-xs font-semibold hover:border-bone/50 disabled:opacity-40"
            >
              Pay back
            </button>
            <button
              type="button"
              disabled={pending || Math.min(balance, debt) < 1}
              onClick={() => payBack(Math.min(balance, debt))}
              className="rounded border border-line bg-raised px-3 py-1.5 text-xs font-semibold hover:border-bone/50 disabled:opacity-40"
            >
              {balance >= debt ? "Pay it all" : "Pay what I have"}
            </button>
          </div>
        </form>
      )}

      {message && (
        <p className={`mt-2 text-xs ${message.tone === "ok" ? "text-gold" : "text-val"}`} aria-live="polite">
          {message.text}
        </p>
      )}
      <p className="mt-3 text-[10px] leading-snug text-gold/50">
        *{offer.interestPct}% interest charged up front, and another {offer.interestPct}% on whatever you owe every
        time a match is finalized. {offer.garnishPct}% of every winning bet&apos;s profit is taken until you&apos;re
        paid up. You may owe at most <Credits n={offer.maxDebt} />. Loans available to players holding under{" "}
        <Credits n={offer.minBalance} />. The house always collects.
      </p>
    </section>
  );
}
