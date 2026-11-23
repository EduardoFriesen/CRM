"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// ponytail: polling every 15 s; switch to server-sent events if boards get busy.
export function AutoRefresh({ everyMs = 15_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return null;
}
