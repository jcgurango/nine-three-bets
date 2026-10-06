"use client";

import { useEffect, useRef, useState } from "react";
import { DELTA_EVENT, prefersReducedMotion } from "@/lib/delta";
import { credits } from "@/lib/format";
import { Credits } from "./Credits";

/** The header balance: counts up or down to new values and floats win/loss amounts past it. */
export function Balance({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  const [floats, setFloats] = useState<{ id: number; amount: number }[]>([]);
  const [mood, setMood] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;
    const duration = prefersReducedMotion() ? 0 : 900;
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const t = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      const next = Math.round(from + (value - from) * (1 - Math.pow(1 - t, 4)));
      shownRef.current = next;
      setShown(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [value]);

  useEffect(() => {
    let nextId = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };
    const onDelta = (e: Event) => {
      const amount = (e as CustomEvent<number>).detail;
      const id = ++nextId;
      setFloats((f) => [...f, { id, amount }]);
      setMood(amount > 0 ? "up" : "down");
      later(() => setFloats((f) => f.filter((x) => x.id !== id)), 2600);
      later(() => setMood(null), 1200);
    };
    window.addEventListener(DELTA_EVENT, onDelta);
    return () => {
      window.removeEventListener(DELTA_EVENT, onDelta);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <span
      id="balance-pill"
      className={`relative rounded bg-raised px-2.5 py-1 font-mono text-sm font-semibold tabular-nums ${
        mood === "up" ? "balance-up" : mood === "down" ? "balance-down" : ""
      }`}
      title="Your credits"
    >
      <Credits n={shown} />
      {floats.map((f) => (
        <span
          key={f.id}
          aria-hidden
          className={`balance-float ${f.amount > 0 ? "text-gold" : "text-val"}`}
        >
          {f.amount > 0 ? "+" : "−"}
          {credits(Math.abs(f.amount))}
        </span>
      ))}
    </span>
  );
}
