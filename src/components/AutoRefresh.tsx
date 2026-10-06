"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-fetches the current page's server data on an interval so odds stay live. */
export function AutoRefresh({ ms = 5000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}
