import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { whatsappInstances } from "@/db/schema";
import { connect, connectionState, createInstance, EvolutionError, setWebhook, type ConnectionState } from "./evolution";
import { hashSecret, newWebhookSecret } from "./secret";

export type ConnectionView = { status: ConnectionState; qrBase64: string | null };
type TenantRef = { id: string; slug: string };

const isStatus = (e: unknown, status: number) => e instanceof EvolutionError && e.status === status;

// Creates the tenant's Evolution instance (named after its slug) with a fresh webhook
// secret and stores only its hash. If the name already exists in Evolution (an orphan from
// a failed run or created by hand), it adopts it by resetting the webhook to the new secret.
async function provision(tenant: TenantRef): Promise<void> {
  const secret = newWebhookSecret();
  try {
    await createInstance(tenant.slug, secret);
  } catch (e) {
    if (!isStatus(e, 403)) throw e;
    await setWebhook(tenant.slug, secret);
  }
  await withTenant(tenant.id, (tx) =>
    tx
      .insert(whatsappInstances)
      .values({ tenantId: tenant.id, name: tenant.slug, secretHash: hashSecret(secret) })
      .onConflictDoUpdate({ target: whatsappInstances.tenantId, set: { secretHash: hashSecret(secret) } }),
  );
}

export async function ensureConnection(tenant: TenantRef): Promise<ConnectionView> {
  const [existing] = await withTenant(tenant.id, (tx) => tx.select().from(whatsappInstances));
  if (!existing) await provision(tenant);

  let status: ConnectionState;
  try {
    status = await connectionState(tenant.slug);
  } catch (e) {
    // The instance was deleted in Evolution while our row survived: provision it again.
    if (!existing || !isStatus(e, 404)) throw e;
    await provision(tenant);
    status = await connectionState(tenant.slug);
  }

  const qrBase64 = status === "open" ? null : (await connect(tenant.slug)).qrBase64;
  await withTenant(tenant.id, (tx) =>
    tx.update(whatsappInstances).set({ status }).where(eq(whatsappInstances.tenantId, tenant.id)),
  );
  return { status, qrBase64 };
}
