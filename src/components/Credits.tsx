import { credits } from "@/lib/format";

/** A credit amount with the credits icon, which takes the surrounding text colour. */
export function Credits({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span className={`whitespace-nowrap ${className}`}>
      <span className="credit-icon" aria-hidden />
      {credits(n)}
      <span className="sr-only"> credits</span>
    </span>
  );
}
