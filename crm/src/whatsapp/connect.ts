import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { whatsappInstances } from "@/db/schema";
import { connect, connectionState, createInstance, type ConnectionState } from "./evolution";
import { hashSecret, newWebhookSecret } from "./secret";

export type ConnectionView = { status: ConnectionState; qrBase64: string | null };

// One Evolution instance per tenant, named after its slug. The instance is created
// in Evolution first so a failed creation leaves no row behind.
// ponytail: if Evolution succeeds but the insert fails, the orphan instance blocks
// re-creation with the same name; delete it in Evolution by hand if that ever happens.
export async function ensureConnection(tenant: { id: string; slug: string }): Promise<ConnectionView> {
  const [existing] = await withTenant(tenant.id, (tx) => tx.select().from(whatsappInstances));
  if (!existing) {
    const secret = newWebhookSecret();
    await createInstance(tenant.slug, secret);
    await withTenant(tenant.id, (tx) =>
      tx.insert(whatsappInstances).values({ tenantId: tenant.id, name: tenant.slug, secretHash: hashSecret(secret) }),
    );
  }
  const status = await connectionState(tenant.slug);
  const qrBase64 = status === "open" ? null : (await connect(tenant.slug)).qrBase64;
  await withTenant(tenant.id, (tx) =>
    tx.update(whatsappInstances).set({ status }).where(eq(whatsappInstances.tenantId, tenant.id)),
  );
  return { status, qrBase64 };
}
