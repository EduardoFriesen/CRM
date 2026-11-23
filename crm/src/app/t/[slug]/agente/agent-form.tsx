"use client";

import { useActionState, useState } from "react";
import type { AgentView } from "@/agent/config";
import type { Provider } from "@/db/schema";
import { relativeTime } from "@/lib/time";
import { saveAgentAction, type AgentFormState, type AgentFormValues } from "./actions";

type FieldErrors = Partial<Record<keyof AgentFormValues | "apiKey", string[]>>;

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic (Claude)",
  google: "Google (Gemini)",
  openai: "OpenAI",
  "openai-compatible": "Compatible con OpenAI (OpenRouter, Groq…)",
};

const KEY_STATUS: Record<AgentView["keyStatus"], { text: string; tone: string }> = {
  valid: { text: "Key verificada", tone: "ok" },
  unverified: { text: "Key sin verificar: no pudimos contactar al proveedor", tone: "warn" },
  invalid: { text: "Key inválida: el proveedor la rechazó. Cargá una nueva.", tone: "bad" },
};

const fromView = (v: AgentView | null): AgentFormValues => ({
  agentName: v?.agentName ?? "",
  provider: v?.provider ?? "anthropic",
  model: v?.model ?? "",
  baseUrl: v?.baseUrl ?? "",
  tone: v?.tone ?? "",
  businessInfo: v?.businessInfo ?? "",
  enabled: v?.enabled ?? false,
  discloseAi: v?.discloseAi ?? true,
});

export function AgentForm({
  slug,
  view,
  suggestions,
}: {
  slug: string;
  view: AgentView | null;
  suggestions: Record<Provider, string[]>;
}) {
  const [state, action, saving] = useActionState<AgentFormState, FormData>(
    (prev, form) => saveAgentAction(slug, prev, form),
    null,
  );
  const result = state?.result;
  const failed = result && !result.success;
  const errors: FieldErrors = failed ? ((result.error.details as FieldErrors) ?? {}) : {};
  const current = result?.success ? result.data : view;
  const values = failed ? state.values : fromView(current);
  const [provider, setProvider] = useState<string>(values.provider);
  const status = current ? KEY_STATUS[current.keyStatus] : null;

  return (
    <form action={action} className="agent-form" noValidate key={failed ? "kept" : (current?.apiKeyLast4 ?? "new")}>
      <section className="panel" aria-labelledby="model-title">
        <h2 id="model-title">Conexión con la IA</h2>
        <Field name="agentName" label="Nombre del agente" hint="Cómo se presenta. Ej. Sofi" errors={errors} defaultValue={values.agentName} />
        <div className="field">
          <label htmlFor="provider">Proveedor</label>
          <select id="provider" name="provider" defaultValue={values.provider} onChange={(e) => setProvider(e.currentTarget.value)}>
            {Object.entries(PROVIDER_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <Field name="model" label="Modelo" errors={errors} defaultValue={values.model} list="model-suggestions" hint="Los modelos chicos inventan más: preferí los sugeridos." />
        <datalist id="model-suggestions">
          {(suggestions[provider as Provider] ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        {provider === "openai-compatible" && (
          <Field name="baseUrl" label="URL base" errors={errors} defaultValue={values.baseUrl} hint="https:// y pública. Ej. https://openrouter.ai/api/v1" />
        )}
        <div className="field">
          <label htmlFor="apiKey">API key</label>
          <input
            id="apiKey"
            name="apiKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={current ? "Dejala vacía para conservar la actual" : ""}
            aria-invalid={errors.apiKey ? true : undefined}
            aria-describedby="apiKey-hint"
          />
          <small id="apiKey-hint" className={errors.apiKey ? "error" : undefined}>
            {errors.apiKey?.[0] ?? (current ? <>Guardada: <span className="mono">••••{current.apiKeyLast4}</span></> : "Se guarda cifrada y nunca se vuelve a mostrar.")}
          </small>
        </div>
        {status && (
          <p className={`key-status ${status.tone}`} role="status">
            {status.text}
          </p>
        )}
        {current?.lastErrorCode && (
          <p className="key-status warn">
            Último error del bot: <span className="mono">{current.lastErrorCode}</span>{" "}
            ({relativeTime(current.lastErrorAt ? new Date(current.lastErrorAt) : null)})
          </p>
        )}
      </section>

      <section className="panel" aria-labelledby="persona-title">
        <h2 id="persona-title">Personalidad e información</h2>
        <Field name="tone" label="Tono y actitud" errors={errors} defaultValue={values.tone} multiline rows={3} hint="Ej. Cálida, breve, con voseo. Sin emojis." />
        <Field
          name="businessInfo"
          label="Información del negocio"
          errors={errors}
          defaultValue={values.businessInfo}
          multiline
          rows={6}
          hint="Horarios, zonas y costos de envío, medios de pago. El bot solo afirma lo que está acá o en el catálogo."
        />
      </section>

      <section className="panel" aria-labelledby="switches-title">
        <h2 id="switches-title">Funcionamiento</h2>
        <label className="check">
          <input type="checkbox" name="enabled" defaultChecked={values.enabled} /> Encender el bot
        </label>
        <label className="check">
          <input type="checkbox" name="discloseAi" defaultChecked={values.discloseAi} /> Presentarse como asistente virtual
        </label>
        <p className="meta-note">
          El texto de las conversaciones se envía al proveedor de IA que elijas. Contemplalo en la política de privacidad
          de tu negocio.
        </p>
      </section>

      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? "Verificando y guardando…" : "Guardar agente"}
        </button>
        <p role="status" className={failed ? "form-error" : "form-ok"}>
          {result ? (result.success ? "Agente guardado." : result.error.message) : ""}
        </p>
      </div>
    </form>
  );
}

function Field(props: {
  name: keyof AgentFormValues;
  label: string;
  errors: FieldErrors;
  defaultValue?: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
  list?: string;
}) {
  const error = props.errors[props.name]?.[0];
  const common = {
    id: props.name,
    name: props.name,
    defaultValue: props.defaultValue,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": `${props.name}-hint`,
  };
  return (
    <div className="field">
      <label htmlFor={props.name}>{props.label}</label>
      {props.multiline ? <textarea {...common} rows={props.rows} /> : <input {...common} list={props.list} autoComplete="off" />}
      <small id={`${props.name}-hint`} className={error ? "error" : undefined}>
        {error ?? props.hint ?? ""}
      </small>
    </div>
  );
}
