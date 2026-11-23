"use client";

import { useState, useTransition } from "react";
import type { Stage } from "@/db/schema";
import { changeStage } from "./actions";
import { STAGE_LABELS } from "./stages";

export function StageSelect({ slug, contactId, stage, name }: { slug: string; contactId: string; stage: Stage; name: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <select
        aria-label={`Etapa de ${name}`}
        defaultValue={stage}
        disabled={pending}
        aria-busy={pending || undefined}
        onChange={(e) => {
          const next = e.currentTarget.value;
          setError(null);
          startTransition(async () => {
            const r = await changeStage(slug, contactId, next);
            if (!r.success) setError(r.error.message);
          });
        }}
      >
        {Object.entries(STAGE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
