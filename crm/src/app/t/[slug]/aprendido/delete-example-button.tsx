"use client";

import { useState, useTransition } from "react";
import { deleteExampleAction } from "./actions";

export function DeleteExampleButton({ slug, id, text }: { slug: string; id: string; text: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="row-actions">
      <button
        type="button"
        className="secondary"
        disabled={pending}
        aria-label={`Borrar atajo: ${text}`}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              const r = await deleteExampleAction(slug, id);
              if (!r.success) setError(r.error.message);
            } catch {
              setError("No pudimos borrarlo, probá de nuevo.");
            }
          })
        }
      >
        Borrar
      </button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
