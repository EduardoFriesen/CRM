"use client";

import { useState, useTransition } from "react";
import { changeStage } from "./actions";

const LABELS = { venta: "Pasar a Venta", consulta: "Volver a Consulta" } as const;

export function StageButton({ slug, contactId, name, to }: { slug: string; contactId: string; name: string; to: keyof typeof LABELS }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="secondary"
        aria-label={`${LABELS[to]}: ${name}`}
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              const r = await changeStage(slug, contactId, to);
              if (!r.success) setError(r.error.message);
            } catch {
              setError("No pudimos cambiar la etapa, probá de nuevo.");
            }
          })
        }
      >
        {pending ? "Moviendo…" : LABELS[to]}
      </button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
