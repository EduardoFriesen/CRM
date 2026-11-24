"use client";

import { useState, useTransition } from "react";
import { closeContactAction } from "./actions";

const FAILED = "No pudimos sacarlo del tablero, probá de nuevo.";

// "Cerrar venta" (Postventa, in the card's foot) or "×" (Consulta, in the card's corner):
// both take the contact off the board; it comes back if the customer writes again.
export function CloseContactButton({
  slug,
  contactId,
  name,
  variant,
}: {
  slug: string;
  contactId: string;
  name: string;
  variant: "sale" | "dismiss";
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const onClick = () =>
    start(async () => {
      setError(null);
      try {
        const r = await closeContactAction(slug, contactId);
        if (!r.success) setError(r.error.message);
      } catch {
        setError(FAILED);
      }
    });

  return (
    <>
      {variant === "sale" ? (
        <button type="button" className="secondary" disabled={pending} aria-busy={pending || undefined} onClick={onClick}>
          {pending ? "Cerrando…" : "Cerrar venta"}
        </button>
      ) : (
        <button
          type="button"
          className="card-dismiss"
          aria-label={`Quitar a ${name} del tablero`}
          title="Quitar del tablero"
          disabled={pending}
          aria-busy={pending || undefined}
          onClick={onClick}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
      {error && (
        <span className={variant === "sale" ? "error" : "card-error"} role="alert">
          {error}
        </span>
      )}
    </>
  );
}
