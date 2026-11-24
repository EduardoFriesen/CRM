"use server";

import { revalidatePath } from "next/cache";
import { saveBusinessProfile, type BusinessProfile } from "@/business/profile";
import type { Result } from "@/lib/result";
import { getCurrentTenant } from "@/tenants/tenants";

export type BusinessFormState = { result: Result<BusinessProfile>; values: BusinessProfile } | null;

export async function saveBusinessAction(slug: string, _prev: BusinessFormState, form: FormData): Promise<BusinessFormState> {
  const tenant = await getCurrentTenant(slug);
  const text = (k: string) => String(form.get(k) ?? "");
  const values: BusinessProfile = {
    hours: text("hours"),
    address: text("address"),
    paymentMethods: text("paymentMethods"),
    shipping: text("shipping"),
    other: text("other"),
  };
  const result = await saveBusinessProfile(tenant.id, values);
  if (result.success) revalidatePath(`/t/${tenant.slug}`, "layout");
  return { result, values };
}
