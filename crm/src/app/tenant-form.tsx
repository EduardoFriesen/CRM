"use client";

import { useActionState } from "react";
import { createTenantAction, type CreateTenantState } from "./actions";

type FieldErrors = Partial<Record<"slug" | "name" | "adminPhone", string[]>>;

const fields = [
  { name: "name", label: "Nombre del negocio", hint: "Ej. Panadería Pepe" },
  { name: "slug", label: "Identificador", hint: "Va en la URL: minúsculas, números y guiones" },
  { name: "adminPhone", label: "WhatsApp del administrador", hint: "Con código de país, solo dígitos: 5491122334455" },
] as const;

export function TenantForm() {
  const [state, action, pending] = useActionState<CreateTenantState, FormData>(createTenantAction, null);
  const errors: FieldErrors = state && !state.success ? ((state.error.details as FieldErrors) ?? {}) : {};

  return (
    <form action={action} className="tenant-form" aria-describedby="tenant-form-status">
      {fields.map((f) => (
        <div key={f.name} className="field">
          <label htmlFor={f.name}>{f.label}</label>
          <input
            id={f.name}
            name={f.name}
            required
            aria-invalid={errors[f.name] ? true : undefined}
            aria-describedby={`${f.name}-hint`}
          />
          <small id={`${f.name}-hint`}>{errors[f.name]?.[0] ?? f.hint}</small>
        </div>
      ))}
      <button type="submit" disabled={pending}>
        {pending ? "Creando…" : "Crear negocio"}
      </button>
      <p id="tenant-form-status" role="status">
        {state?.success ? `Listo: ${state.data.name} creado.` : state ? state.error.message : ""}
      </p>
    </form>
  );
}
