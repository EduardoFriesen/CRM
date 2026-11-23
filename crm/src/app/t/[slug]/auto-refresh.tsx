"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { shouldAutoRefresh } from "./refresh-guard";

// ponytail: polling every 15 s; switch to server-sent events if boards get busy.
export function AutoRefresh({ everyMs = 15_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (shouldAutoRefresh(document)) router.refresh();
    }, everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return null;
}
