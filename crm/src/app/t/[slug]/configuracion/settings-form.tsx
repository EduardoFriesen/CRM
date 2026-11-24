"use client";

import { useActionState } from "react";
import { saveSettingsAction, type SettingsFormState } from "./actions";

export function SettingsForm({ slug, consultaIdleDays }: { slug: string; consultaIdleDays: number }) {
  const [state, action, saving] = useActionState<SettingsFormState, FormData>((prev, form) => saveSettingsAction(slug, prev, form), null);
  const result = state?.result;
  const error = result && !result.success ? ((result.error.details as { consultaIdleDays?: string[] })?.consultaIdleDays?.[0] ?? result.error.message) : null;

  return (
    <form action={action} className="agent-form" noValidate>
      <section className="panel">
        <h2>Tablero</h2>
        <div className="field">
          <label htmlFor="consultaIdleDays">Quitar consultas sin actividad después de N días</label>
          <input
            id="consultaIdleDays"
            name="consultaIdleDays"
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            step={1}
            required
            defaultValue={state?.consultaIdleDays ?? consultaIdleDays}
            aria-invalid={error ? true : undefined}
            aria-describedby="consultaIdleDays-hint"
          />
          <small id="consultaIdleDays-hint" className={error ? "error" : undefined}>
            {error ?? "Entre 1 y 30. Si el cliente vuelve a escribir, reaparece en Consulta como una conversación nueva."}
          </small>
        </div>
      </section>
      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? "Guardando…" : "Guardar configuración"}
        </button>
        <p role="status" className={error ? "form-error" : "form-ok"}>
          {result?.success ? "Configuración guardada." : ""}
        </p>
      </div>
    </form>
  );
}
