"use client";

import { useState, useTransition } from "react";
import { dismissAction } from "./actions";

export function DismissButton({ slug, id, question }: { slug: string; id: string; question: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="row-actions">
      <button
        type="button"
        className="secondary"
        disabled={pending}
        aria-label={`Descartar consulta: ${question}`}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              const r = await dismissAction(slug, id);
              if (!r.success) setError(r.error.message);
            } catch {
              setError("No pudimos descartarla, probá de nuevo.");
            }
          })
        }
      >
        Descartar
      </button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
