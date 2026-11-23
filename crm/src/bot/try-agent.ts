import type { LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getAgentRuntime } from "@/agent/config";
import { createModel, isAuthError } from "@/agent/model";
import { getDb } from "@/db/client";
import { tenants, type Stage } from "@/db/schema";
import { fail, ok, type Result } from "@/lib/result";
import { buildSystemPrompt } from "./prompt";
import { generateAgentText, truncateForWhatsApp } from "./reply";
import { makeTools } from "./tools";

const historyInput = z
  .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(1000) }))
  .min(1)
  .max(20);

export type TryTurn = z.infer<typeof historyInput>[number];

// Test chat: same prompt, model and tools as the WhatsApp bot, but set_stage is a dry run
// and nothing is stored or sent. Works while the bot is switched off.
export async function tryAgent(
  tenantId: string,
  history: unknown,
  deps: { model?: LanguageModel } = {},
): Promise<Result<{ reply: string; stage: Stage | null }>> {
  const parsed = historyInput.safeParse(history);
  if (!parsed.success) return fail("VALIDATION", "Conversación de prueba inválida");
  const rt = await getAgentRuntime(tenantId);
  if (!rt) return fail("NO_KEY", "Cargá una API key para probar el agente");

  const [tenant] = await getDb().select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
  let stage: Stage | null = null;
  const system = buildSystemPrompt({ ...rt, tenantName: tenant?.name ?? "", introduce: rt.discloseAi && parsed.data.length === 1, now: new Date() });
  try {
    const model = deps.model ?? (await createModel(rt));
    const reply = await generateAgentText(model, {
      system,
      // Providers expect the conversation to open with the user.
      messages: parsed.data
        .slice(Math.max(0, parsed.data.findIndex((m) => m.role === "user")))
        .map((m) => ({ role: m.role, content: m.text })),
      tools: makeTools(tenantId, "", { dryRun: true, onStage: (s) => (stage = s) }),
    });
    return ok({ reply: truncateForWhatsApp(reply.trim()), stage });
  } catch (e) {
    if (isAuthError(e)) return fail("KEY_INVALID", "El proveedor rechazó la API key");
    return fail("MODEL_ERROR", "El modelo no respondió. Probá de nuevo en unos segundos.");
  }
}
