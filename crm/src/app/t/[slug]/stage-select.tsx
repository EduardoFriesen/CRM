"use client";

import { useState, useTransition } from "react";
import type { Stage } from "@/db/schema";
import { changeStage } from "./actions";
import { STAGE_LABELS } from "./stages";

const FAILED = "No pudimos cambiar la etapa, probá de nuevo.";

export function StageSelect({
  slug,
  contactId,
  stage,
  name,
  canPostventa = true,
}: {
  slug: string;
  contactId: string;
  stage: Stage;
  name: string;
  canPostventa?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<string>(stage);
  const [error, setError] = useState<string | null>(null);

  const onChange = (next: string) => {
    setValue(next);
    setError(null);
    startTransition(async () => {
      let message: string | null = FAILED;
      try {
        const r = await changeStage(slug, contactId, next);
        message = r.success ? null : r.error.message;
      } catch {
        // Network or server failure: keep the board, revert below.
      }
      if (message) {
        setValue(stage);
        setError(message);
      }
    });
  };

  return (
    <>
      <select
        aria-label={`Etapa de ${name}`}
        value={value}
        disabled={pending}
        aria-busy={pending || undefined}
        onChange={(e) => onChange(e.currentTarget.value)}
      >
        {Object.entries(STAGE_LABELS).map(([v, label]) => {
          // Postventa needs a delivered order (the server enforces it too).
          const locked = v === "postventa" && !canPostventa && stage !== "postventa";
          return (
            <option key={v} value={v} disabled={locked}>
              {locked ? `${label} (requiere pedido entregado)` : label}
            </option>
          );
        })}
      </select>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
