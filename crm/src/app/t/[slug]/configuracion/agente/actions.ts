"use server";

import { revalidatePath } from "next/cache";
import { saveAgentConfig, type AgentView } from "@/agent/config";
import { tryAgent, type TryReply, type TryTurn } from "@/bot/try-agent";
import type { Result } from "@/lib/result";
import { getCurrentTenant } from "@/tenants/tenants";

// Submitted values travel back on failure; the API key never does.
export type AgentFormValues = {
  agentName: string;
  provider: string;
  model: string;
  routerModel: string;
  baseUrl: string;
  tone: string;
  enabled: boolean;
  discloseAi: boolean;
  pauseHours: string;
  adminPhone: string;
  dailyRequestLimit: string;
  dailyTokenLimit: string;
};
export type AgentFormState = { result: Result<AgentView>; values: AgentFormValues } | null;

export async function saveAgentAction(slug: string, _prev: AgentFormState, form: FormData): Promise<AgentFormState> {
  const tenant = await getCurrentTenant(slug);
  const text = (k: string) => String(form.get(k) ?? "");
  const values: AgentFormValues = {
    agentName: text("agentName"),
    provider: text("provider"),
    model: text("model"),
    routerModel: text("routerModel"),
    baseUrl: text("baseUrl"),
    tone: text("tone"),
    enabled: form.get("enabled") === "on",
    discloseAi: form.get("discloseAi") === "on",
    pauseHours: text("pauseHours"),
    adminPhone: text("adminPhone"),
    dailyRequestLimit: text("dailyRequestLimit"),
    dailyTokenLimit: text("dailyTokenLimit"),
  };
  const result = await saveAgentConfig(tenant.id, { ...values, apiKey: text("apiKey") });
  if (result.success) revalidatePath(`/t/${tenant.slug}`, "layout");
  return { result, values };
}

export async function tryAgentAction(
  slug: string,
  history: TryTurn[],
): Promise<Result<TryReply>> {
  const tenant = await getCurrentTenant(slug);
  return tryAgent(tenant.id, history);
}
