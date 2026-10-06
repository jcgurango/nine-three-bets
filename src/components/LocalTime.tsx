"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** Renders a unix timestamp in the viewer's own time zone (empty until hydrated). */
export function LocalTime({ ts }: { ts: number }) {
  const text = useSyncExternalStore(
    subscribe,
    () =>
      new Date(ts * 1000).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    () => "",
  );
  return <time dateTime={new Date(ts * 1000).toISOString()}>{text}</time>;
}
