"use server";

import { revalidatePath } from "next/cache";
import { saveAgentConfig, type AgentView } from "@/agent/config";
import type { Result } from "@/lib/result";
import { getCurrentTenant } from "@/tenants/tenants";

// Submitted values travel back on failure; the API key never does.
export type AgentFormValues = {
  agentName: string;
  provider: string;
  model: string;
  baseUrl: string;
  tone: string;
  businessInfo: string;
  enabled: boolean;
  discloseAi: boolean;
};
export type AgentFormState = { result: Result<AgentView>; values: AgentFormValues } | null;

export async function saveAgentAction(slug: string, _prev: AgentFormState, form: FormData): Promise<AgentFormState> {
  const tenant = await getCurrentTenant(slug);
  const text = (k: string) => String(form.get(k) ?? "");
  const values: AgentFormValues = {
    agentName: text("agentName"),
    provider: text("provider"),
    model: text("model"),
    baseUrl: text("baseUrl"),
    tone: text("tone"),
    businessInfo: text("businessInfo"),
    enabled: form.get("enabled") === "on",
    discloseAi: form.get("discloseAi") === "on",
  };
  const result = await saveAgentConfig(tenant.id, { ...values, apiKey: text("apiKey") });
  if (result.success) revalidatePath(`/t/${tenant.slug}`, "layout");
  return { result, values };
}
