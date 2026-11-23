"use server";

import { revalidatePath } from "next/cache";
import { deleteFact, updateFact } from "@/facts/facts";
import type { BusinessFact } from "@/db/schema";
import type { Result } from "@/lib/result";
import { getCurrentTenant } from "@/tenants/tenants";

export async function updateFactAction(slug: string, id: string, question: string, answer: string): Promise<Result<BusinessFact>> {
  const tenant = await getCurrentTenant(slug);
  const r = await updateFact(tenant.id, id, { question, answer });
  if (r.success) revalidatePath(`/t/${tenant.slug}/aprendido`);
  return r;
}

export async function deleteFactAction(slug: string, id: string): Promise<Result<{ id: string }>> {
  const tenant = await getCurrentTenant(slug);
  const r = await deleteFact(tenant.id, id);
  if (r.success) revalidatePath(`/t/${tenant.slug}/aprendido`);
  return r;
}
