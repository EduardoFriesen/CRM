import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { decrypt, encrypt } from "@/crypto/secret-box";
import { withTenant } from "@/db/client";
import { agentConfigs, tenants, PROVIDERS, type AgentConfigRow, type KeyStatus, type Provider } from "@/db/schema";
import { fail, ok, type Result } from "@/lib/result";
import { recordUsage } from "@/usage/usage";
import { assertSafeBaseUrl, UnsafeBaseUrlError } from "./base-url";
import { ollamaUrl, verifyKeyDetailed, type KeyCheck, type KeyCheckResult, type ModelSettings } from "./model";

// Placeholder stored for Ollama, which has no key (api_key_enc is required).
const LOCAL_KEY = "local";

export type AgentView = {
  agentName: string;
  tone: string;
  businessInfo: string;
  provider: Provider;
  model: string;
  baseUrl: string | null;
  apiKeyLast4: string;
  keyStatus: KeyStatus;
  enabled: boolean;
  discloseAi: boolean;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
  pauseHours: number;
  adminPhone: string;
  dailyRequestLimit: number | null;
  dailyTokenLimit: number | null;
};

export type AgentRuntime = ModelSettings & {
  agentName: string;
  tone: string;
  businessInfo: string;
  enabled: boolean;
  discloseAi: boolean;
  keyStatus: KeyStatus;
  pauseHours: number;
};

// Checkboxes post "on" when checked and nothing when unchecked.
const flag = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());

// Integer limits as people type them here: "1.000", "200 000" or "1,000" all mean thousands.
const dailyLimit = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === "") return null;
    const digits = String(v).replace(/[.\s,_]/g, "");
    return /^\d+$/.test(digits) ? Number(digits) : Number.NaN;
  },
  z
    .number({ error: "Escribí solo números (ej. 1000)" })
    .int("Escribí solo números (ej. 1000)")
    .min(1, "Mínimo 1")
    .max(1_000_000_000, "Demasiado alto")
    .nullable(),
);

export const agentInput = z.object({
  agentName: z.string().trim().min(1, "Poné un nombre").max(60, "Máximo 60 caracteres"),
  tone: z.string().trim().max(2000, "Máximo 2000 caracteres").default(""),
  businessInfo: z.string().trim().max(8000, "Máximo 8000 caracteres").default(""),
  provider: z.enum(PROVIDERS, { error: "Elegí un proveedor" }),
  model: z.string().trim().min(1, "Indicá el modelo").max(100),
  baseUrl: z.string().trim().max(300).optional(),
  apiKey: z.string().trim().max(500).optional(),
  enabled: flag,
  discloseAi: flag,
  pauseHours: z.preprocess(
    (v) => (v === undefined || v === "" ? 12 : v),
    z.coerce.number().int("Tiene que ser un número entero").min(1, "Entre 1 y 168 horas").max(168, "Entre 1 y 168 horas"),
  ),
  dailyRequestLimit: dailyLimit,
  dailyTokenLimit: dailyLimit,
  adminPhone: z
    .string()
    .trim()
    .regex(/^\d{10,15}$/, "Solo dígitos, con código de país (ej. 5491122334455)")
    .optional(),
});

const toView = (r: AgentConfigRow, adminPhone: string): AgentView => ({
  agentName: r.agentName,
  tone: r.tone,
  businessInfo: r.businessInfo,
  provider: r.provider,
  model: r.model,
  baseUrl: r.baseUrl,
  apiKeyLast4: r.apiKeyLast4,
  keyStatus: r.keyStatus,
  enabled: r.enabled,
  discloseAi: r.discloseAi,
  lastErrorCode: r.lastErrorCode,
  lastErrorAt: r.lastErrorAt,
  pauseHours: r.pauseHours,
  adminPhone,
  dailyRequestLimit: r.dailyRequestLimit,
  dailyTokenLimit: r.dailyTokenLimit,
});

const loadAdminPhone = async (tenantId: string) =>
  (await withTenant(tenantId, (tx) => tx.select({ p: tenants.adminPhone }).from(tenants).where(eq(tenants.id, tenantId))))[0]?.p ?? "";

const load = async (tenantId: string) =>
  (await withTenant(tenantId, (tx) => tx.select().from(agentConfigs)))[0] ?? null;

export async function getAgentView(tenantId: string): Promise<AgentView | null> {
  const row = await load(tenantId);
  return row && toView(row, await loadAdminPhone(tenantId));
}

// Server-only: includes the decrypted API key.
export async function getAgentRuntime(tenantId: string): Promise<AgentRuntime | null> {
  const row = await load(tenantId);
  if (!row) return null;
  return { ...toView(row, await loadAdminPhone(tenantId)), apiKey: decrypt(row.apiKeyEnc) };
}

export async function isBotActive(tenantId: string): Promise<boolean> {
  const row = await load(tenantId);
  return !!row && row.enabled && row.keyStatus !== "invalid";
}

export async function saveAgentConfig(
  tenantId: string,
  input: unknown,
  verify: (s: ModelSettings) => Promise<KeyCheck | KeyCheckResult> = verifyKeyDetailed,
): Promise<Result<AgentView>> {
  const parsed = agentInput.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION", "Revisá la configuración del agente", z.flattenError(parsed.error).fieldErrors);
  }
  const { apiKey: newKey, baseUrl: rawBaseUrl, adminPhone, ...data } = parsed.data;

  let baseUrl: string | null = null;
  if (data.provider === "openai-compatible") {
    try {
      baseUrl = (await assertSafeBaseUrl(rawBaseUrl ?? "")).toString();
    } catch (e) {
      const message = e instanceof UnsafeBaseUrlError ? e.message : "URL inválida";
      return fail("VALIDATION", "Revisá la configuración del agente", { baseUrl: [message] });
    }
  }

  const local = data.provider === "ollama";
  if (local && !ollamaUrl()) {
    return fail("VALIDATION", "Revisá la configuración del agente", { provider: ["Ollama no está disponible en este servidor"] });
  }

  const existing = await load(tenantId);
  // Ollama needs no key; its stored placeholder must never pass as a cloud provider's key.
  const storedKey = existing && existing.provider !== "ollama" ? decrypt(existing.apiKeyEnc) : "";
  const apiKey = local ? LOCAL_KEY : newKey || storedKey;
  if (!apiKey) return fail("VALIDATION", "Revisá la configuración del agente", { apiKey: ["Cargá la API key"] });

  const settings: ModelSettings = { provider: data.provider, model: data.model, apiKey, baseUrl };
  const unchanged =
    !newKey && existing?.provider === data.provider && existing.model === data.model && existing.baseUrl === baseUrl;
  const result: KeyCheckResult = unchanged
    ? { status: existing.keyStatus, code: null }
    : await verify(settings).then((r) => (typeof r === "string" ? { status: r, code: null } : r));
  // The verification call spends provider quota too.
  if (!unchanged) await recordUsage(tenantId, { requests: 1 }).catch(() => {});
  const check = result.status;
  if (check === "invalid" && !unchanged) return fail("KEY_INVALID", "El proveedor rechazó la API key");
  const keyStatus: KeyStatus = check === "quota" ? "valid" : check;
  // A fresh check replaces the last error: quota exhausted is flagged, a clean pass clears it.
  const lastError = unchanged
    ? {}
    : check === "unverified"
      ? result.code
        ? { lastErrorCode: `VERIFY_${result.code}`, lastErrorAt: sql`now()` }
        : {}
      : check === "quota"
        ? { lastErrorCode: "QUOTA_EXCEEDED", lastErrorAt: sql`now()` }
        : { lastErrorCode: null, lastErrorAt: null };

  const values = {
    ...data,
    baseUrl,
    apiKeyEnc: encrypt(apiKey),
    apiKeyLast4: local ? "" : apiKey.slice(-4),
    keyStatus,
    ...lastError,
    updatedAt: sql`now()`,
  };
  const [row] = await withTenant(tenantId, async (tx) => {
    if (adminPhone) await tx.update(tenants).set({ adminPhone }).where(eq(tenants.id, tenantId));
    return tx
      .insert(agentConfigs)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: agentConfigs.tenantId, set: values })
      .returning();
  });
  return ok(toView(row, await loadAdminPhone(tenantId)));
}

export async function markKeyInvalid(tenantId: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.update(agentConfigs).set({ keyStatus: "invalid" }).where(eq(agentConfigs.tenantId, tenantId)),
  );
}

export async function recordAgentError(tenantId: string, code: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(agentConfigs)
      .set({ lastErrorCode: code.slice(0, 80), lastErrorAt: sql`now()` })
      .where(eq(agentConfigs.tenantId, tenantId)),
  );
}
