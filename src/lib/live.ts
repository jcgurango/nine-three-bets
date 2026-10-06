/**
 * In-process wake-up for open /api/events streams, so results reach players
 * the moment an admin pays out. Streams also poll on a timer, which covers
 * deployments with more than one server instance.
 */
const globalForLive = globalThis as unknown as { __eventStreamWakers?: Set<() => void> };
const wakers = (globalForLive.__eventStreamWakers ??= new Set());

export function onWake(fn: () => void): () => void {
  wakers.add(fn);
  return () => wakers.delete(fn);
}

export function wakeEventStreams(): void {
  for (const fn of wakers) fn();
}
