"use server";

import { fail, ok, type Result } from "@/lib/result";
import { getCurrentTenant } from "@/tenants/tenants";
import { ensureConnection, type ConnectionView } from "@/whatsapp/connect";
import { EvolutionError } from "@/whatsapp/evolution";

export async function connectWhatsApp(slug: string): Promise<Result<ConnectionView>> {
  const tenant = await getCurrentTenant(slug);
  try {
    return ok(await ensureConnection(tenant));
  } catch (e) {
    // Log the cause without payloads: Evolution responses can carry instance tokens.
    console.error(`whatsapp connect failed for tenant ${tenant.id}: ${e instanceof EvolutionError ? e.message : "unexpected error"}`);
    return fail("WHATSAPP_UNAVAILABLE", "No pudimos hablar con WhatsApp, reintentá en unos segundos.");
  }
}
