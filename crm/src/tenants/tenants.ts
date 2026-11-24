import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import { fail, ok, type Result } from "@/lib/result";

export type Tenant = typeof tenants.$inferSelect;

const slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "Solo minúsculas, números y guiones (3 a 40)");

export const tenantInput = z.object({
  slug,
  name: z.string().trim().min(2, "Mínimo 2 caracteres").max(80, "Máximo 80 caracteres"),
  adminPhone: z.string().regex(/^\d{10,15}$/, "Solo dígitos, con código de país (ej. 5491122334455)"),
});

export async function createTenant(input: unknown): Promise<Result<Tenant>> {
  const parsed = tenantInput.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION", "Revisá los datos del negocio", z.flattenError(parsed.error).fieldErrors);
  }
  const [row] = await getDb().insert(tenants).values(parsed.data).onConflictDoNothing().returning();
  return row ? ok(row) : fail("SLUG_TAKEN", "Ya existe un negocio con ese identificador");
}

export function listTenants(): Promise<Tenant[]> {
  return getDb().select().from(tenants).orderBy(tenants.name);
}

export async function getTenantBySlug(value: string): Promise<Tenant | null> {
  if (!slug.safeParse(value).success) return null;
  const [row] = await getDb().select().from(tenants).where(eq(tenants.slug, value));
  return row ?? null;
}

// The single place the active tenant is resolved from a request.
// Keycloak: replace with OIDC claim + membership check.
export async function getCurrentTenant(value: string): Promise<Tenant> {
  const tenant = await getTenantBySlug(value);
  if (!tenant) notFound();
  return tenant;
}

const IDLE_DAYS = "Entre 1 y 30 días";
const boardSettings = z.object({
  consultaIdleDays: z.coerce.number({ error: IDLE_DAYS }).int(IDLE_DAYS).min(1, IDLE_DAYS).max(30, IDLE_DAYS),
});

export async function saveBoardSettings(tenantId: string, input: unknown): Promise<Result<{ consultaIdleDays: number }>> {
  const parsed = boardSettings.safeParse(input);
  if (!parsed.success) return fail("VALIDATION", "Revisá la configuración", z.flattenError(parsed.error).fieldErrors);
  const [row] = await getDb()
    .update(tenants)
    .set({ consultaIdleDays: parsed.data.consultaIdleDays })
    .where(eq(tenants.id, tenantId))
    .returning({ consultaIdleDays: tenants.consultaIdleDays });
  return row ? ok(row) : fail("NOT_FOUND", "No encontramos el negocio");
}
