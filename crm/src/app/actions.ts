"use server";

import { revalidatePath } from "next/cache";
import type { Result } from "@/lib/result";
import { createTenant, type Tenant } from "@/tenants/tenants";

export type TenantFormValues = { slug: string; name: string; adminPhone: string };
// Submitted values travel back so a failed submit doesn't wipe the form (React resets it).
export type CreateTenantState = { result: Result<Tenant>; values: TenantFormValues } | null;

const EMPTY: TenantFormValues = { slug: "", name: "", adminPhone: "" };

export async function createTenantAction(_prev: CreateTenantState, form: FormData): Promise<CreateTenantState> {
  const values: TenantFormValues = {
    slug: String(form.get("slug") ?? ""),
    name: String(form.get("name") ?? ""),
    adminPhone: String(form.get("adminPhone") ?? ""),
  };
  const result = await createTenant(values);
  if (!result.success) return { result, values };
  revalidatePath("/");
  return { result, values: EMPTY };
}
