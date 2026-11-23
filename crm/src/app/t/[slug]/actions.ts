"use server";

import { revalidatePath } from "next/cache";
import { setContactStage } from "@/contacts/contacts";
import type { Result } from "@/lib/result";
import type { Stage } from "@/db/schema";
import { getCurrentTenant } from "@/tenants/tenants";

export async function changeStage(slug: string, contactId: string, stage: string): Promise<Result<{ id: string; stage: Stage }>> {
  const tenant = await getCurrentTenant(slug);
  const result = await setContactStage(tenant.id, contactId, stage);
  if (result.success) revalidatePath(`/t/${tenant.slug}`);
  return result;
}
