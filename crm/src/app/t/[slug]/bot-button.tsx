"use client";

import { useState, useTransition } from "react";
import { setBotOffAction } from "./actions";

// "Reactivar bot" / "Activar bot" turn the chat's bot back on (also ending a pause and an
// attention); "Desactivar bot" turns it off until someone turns it on again.
export function BotButton({
  slug,
  contactId,
  name,
  off,
  label,
}: {
  slug: string;
  contactId: string;
  name: string;
  off: boolean;
  label: "Reactivar bot" | "Activar bot" | "Desactivar bot";
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="secondary"
        aria-label={`${label}: ${name}`}
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              const r = await setBotOffAction(slug, contactId, off);
              if (!r.success) setError(r.error.message);
            } catch {
              setError("No pudimos cambiar el bot, probá de nuevo.");
            }
          })
        }
      >
        {pending ? "Guardando…" : label}
      </button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
