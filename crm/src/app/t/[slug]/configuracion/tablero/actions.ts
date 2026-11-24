"use server";

import { revalidatePath } from "next/cache";
import type { Result } from "@/lib/result";
import { getCurrentTenant, saveBoardSettings } from "@/tenants/tenants";

export type SettingsFormState = { result: Result<{ consultaIdleDays: number }>; consultaIdleDays: string } | null;

export async function saveSettingsAction(slug: string, _prev: SettingsFormState, form: FormData): Promise<SettingsFormState> {
  const tenant = await getCurrentTenant(slug);
  const consultaIdleDays = String(form.get("consultaIdleDays") ?? "");
  const result = await saveBoardSettings(tenant.id, { consultaIdleDays });
  if (result.success) revalidatePath(`/t/${tenant.slug}`, "layout");
  return { result, consultaIdleDays };
}
