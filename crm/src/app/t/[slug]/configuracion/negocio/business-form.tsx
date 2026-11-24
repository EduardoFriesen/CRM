"use client";

import { useActionState } from "react";
import type { BusinessProfile } from "@/business/profile";
import { saveBusinessAction, type BusinessFormState } from "./actions";

type FieldErrors = Partial<Record<keyof BusinessProfile, string[]>>;

const FIELDS: { name: keyof BusinessProfile; label: string; hint: string; rows: number }[] = [
  { name: "hours", label: "Horarios", hint: "Ej. Lun a vie de 9 a 18, sáb de 9 a 13", rows: 2 },
  { name: "address", label: "Dirección", hint: "Ej. Av. Siempreviva 742, Rosario", rows: 2 },
  { name: "paymentMethods", label: "Medios de pago", hint: "Ej. Efectivo, transferencia y Mercado Pago", rows: 2 },
  { name: "shipping", label: "Envíos", hint: "Ej. Envíos a todo Rosario, gratis desde $20.000", rows: 2 },
  { name: "other", label: "Otros", hint: "Cualquier otra información que el bot pueda compartir.", rows: 5 },
];

export function BusinessForm({ slug, profile }: { slug: string; profile: BusinessProfile }) {
  const [state, action, saving] = useActionState<BusinessFormState, FormData>((prev, form) => saveBusinessAction(slug, prev, form), null);
  const result = state?.result;
  const failed = result && !result.success;
  const errors: FieldErrors = failed ? ((result.error.details as FieldErrors) ?? {}) : {};
  const values = state?.values ?? profile;

  return (
    <form action={action} className="agent-form" noValidate>
      <section className="panel">
        <h2>Información del negocio</h2>
        {FIELDS.map((f) => {
          const error = errors[f.name]?.[0];
          return (
            <div className="field" key={f.name}>
              <label htmlFor={f.name}>{f.label}</label>
              <textarea
                id={f.name}
                name={f.name}
                rows={f.rows}
                defaultValue={values[f.name]}
                aria-invalid={error ? true : undefined}
                aria-describedby={`${f.name}-hint`}
              />
              <small id={`${f.name}-hint`} className={error ? "error" : undefined}>
                {error ?? f.hint}
              </small>
            </div>
          );
        })}
      </section>
      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        <p role="status" className={failed ? "form-error" : "form-ok"}>
          {result ? (result.success ? "Información guardada." : result.error.message) : ""}
        </p>
      </div>
    </form>
  );
}
