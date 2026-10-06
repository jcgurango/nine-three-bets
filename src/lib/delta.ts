/** Browser event that makes the header balance show a floating "+1,000" / "-1,000". */
export const DELTA_EVENT = "ninethree:delta";

export function showBalanceDelta(amount: number): void {
  if (amount !== 0) window.dispatchEvent(new CustomEvent<number>(DELTA_EVENT, { detail: amount }));
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
