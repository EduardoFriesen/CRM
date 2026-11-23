"use server";

import { revalidatePath } from "next/cache";
import type { Result } from "@/lib/result";
import { createTenant, type Tenant } from "@/tenants/tenants";

export type CreateTenantState = Result<Tenant> | null;

export async function createTenantAction(_prev: CreateTenantState, form: FormData): Promise<CreateTenantState> {
  const result = await createTenant({
    slug: form.get("slug"),
    name: form.get("name"),
    adminPhone: form.get("adminPhone"),
  });
  if (result.success) revalidatePath("/");
  return result;
}
