import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { businessProfiles } from "@/db/schema";
import { fail, ok, type Result } from "@/lib/result";

export type BusinessProfile = { hours: string; address: string; paymentMethods: string; shipping: string; other: string };

const EMPTY: BusinessProfile = { hours: "", address: "", paymentMethods: "", shipping: "", other: "" };

const short = z.string().trim().max(1000).default("");
const profileInput = z.object({ hours: short, address: short, paymentMethods: short, shipping: short, other: z.string().trim().max(8000).default("") });

export async function getBusinessProfile(tenantId: string): Promise<BusinessProfile> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({
        hours: businessProfiles.hours,
        address: businessProfiles.address,
        paymentMethods: businessProfiles.paymentMethods,
        shipping: businessProfiles.shipping,
        other: businessProfiles.other,
      })
      .from(businessProfiles)
      .where(eq(businessProfiles.tenantId, tenantId)),
  );
  return row ?? EMPTY;
}

export async function saveBusinessProfile(tenantId: string, input: unknown): Promise<Result<BusinessProfile>> {
  const parsed = profileInput.safeParse(input);
  if (!parsed.success) return fail("VALIDATION", "Revisá la información del negocio", z.flattenError(parsed.error).fieldErrors);
  await withTenant(tenantId, (tx) =>
    tx
      .insert(businessProfiles)
      .values({ tenantId, ...parsed.data })
      .onConflictDoUpdate({ target: businessProfiles.tenantId, set: { ...parsed.data, updatedAt: new Date() } }),
  );
  return ok(parsed.data);
}
