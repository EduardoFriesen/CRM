"use client";

import { useState, useTransition } from "react";
import { reactivateAction } from "./actions";

export function ReactivateButton({ slug, contactId }: { slug: string; contactId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              const r = await reactivateAction(slug, contactId);
              if (!r.success) setError(r.error.message);
            } catch {
              setError("No pudimos reactivar el bot, probá de nuevo.");
            }
          })
        }
      >
        {pending ? "Reactivando…" : "Reactivar bot"}
      </button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
