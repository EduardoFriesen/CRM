import type { LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getAgentRuntime } from "@/agent/config";
import { describeAgentError } from "@/agent/errors";
import { createModel, isAuthError, isQuotaExhausted } from "@/agent/model";
import { getBusinessProfile } from "@/business/profile";
import { getDb } from "@/db/client";
import { recentFacts } from "@/facts/facts";
import { tenants, type Stage } from "@/db/schema";
import { fail, ok, type Result } from "@/lib/result";
import type { BotPath } from "@/usage/events";
import { answerTurn } from "./faq/turn";
import { toModelMessages } from "./history";
import { buildSystemPrompt } from "./prompt";
import { errorCode, generateAgentText, SAFE_HANDOFF_TEXT, truncateForWhatsApp, withAskedReply } from "./reply";
import { asksForSensitiveData } from "./sensitive-guard";
import { makeTools } from "./tools";

const HANDOFF_NOTE = "(el bot pasaría la charla a alguien del equipo)";
const attentionNote = (reason: string) => `(el bot avisaría al admin que necesita atención: ${reason})`;

const historyInput = z
  .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(1000), handoff: z.boolean().optional() }))
  .min(1)
  .max(20);

export type TryTurn = z.infer<typeof historyInput>[number];
export type TryReply = { reply: string; stage: Stage | null; adminNote: string | null; handoff: boolean; path: BotPath };

// Test chat: same prompt, model and tools as the WhatsApp bot, but set_stage is a dry run
// and nothing is stored or sent. Works while the bot is switched off.
export async function tryAgent(
  tenantId: string,
  history: unknown,
  deps: { model?: LanguageModel; /** null skips the router. Defaults to null when `model` is given (tests), else the tenant's router model. */ routerModel?: LanguageModel | null } = {},
): Promise<Result<TryReply>> {
  const parsed = historyInput.safeParse(history);
  if (!parsed.success) return fail("VALIDATION", "Conversación de prueba inválida");
  const rt = await getAgentRuntime(tenantId);
  if (!rt) return fail("NO_KEY", "Cargá una API key para probar el agente");

  const [tenant] = await getDb().select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
  let stage: Stage | null = null;
  let adminNote: string | null = null;
  let handoff = false;
  const facts = await recentFacts(tenantId);
  const system = buildSystemPrompt({ ...rt, business: await getBusinessProfile(tenantId), cache: rt.provider === "anthropic", tenantName: tenant?.name ?? "", introduce: rt.discloseAi && parsed.data.length === 1, now: new Date(), facts });
  try {
    const model = deps.model ?? (await createModel(rt));
    const routerModel =
      deps.routerModel !== undefined ? deps.routerModel : deps.model ? null : await createModel({ ...rt, model: rt.routerModel ?? rt.model });
    const turn = await answerTurn(tenantId, {
      turns: parsed.data,
      stage: "consulta",
      contactId: "",
      introduce: rt.discloseAi && parsed.data.length === 1,
      tenantName: tenant?.name ?? "",
      routerModel,
      // Same model call as WhatsApp, but tools are dry runs.
      runComplex: async () => {
        let asked = false;
        const reply = await generateAgentText(tenantId, model, {
          system,
          messages: toModelMessages(parsed.data, { toolCalls: true }),
          tools: makeTools(tenantId, "", {
            dryRun: true,
            onStage: (s) => (stage = s),
            onHandoff: () => (handoff = true),
            onAdmin: (kind, text) =>
              (adminNote = kind === "ask" ? `(el bot consultaría al admin: ${text})` : kind === "attention" ? attentionNote(text) : HANDOFF_NOTE),
            onAsked: () => (asked = true),
          }),
        });
        return withAskedReply(reply, asked, { introduce: rt.discloseAi && parsed.data.length === 1, tenant: tenant?.name ?? "" });
      },
      // A template handoff stays a dry run: no escalation, no pause, no notification.
      doHandoff: async () => {
        handoff = true;
        adminNote = HANDOFF_NOTE;
      },
      doAttention: async (reason) => {
        handoff = true;
        adminNote = attentionNote(reason);
      },
    });
    if (turn.skip) {
      if (turn.skip === "skipped:key-invalid") return fail("KEY_INVALID", "El proveedor rechazó la API key");
      if (turn.skip === "skipped:quota") return fail("QUOTA_EXCEEDED", describeAgentError("QUOTA_EXCEEDED"));
      return fail("MODEL_ERROR", "El modelo no respondió. Probá de nuevo en unos segundos.");
    }
    if (turn.text === null) return ok({ path: turn.path, reply: "", stage, adminNote: "(el bot no respondería: mensaje trivial)", handoff: false });
    const reply = turn.text;
    // Same guard as the WhatsApp bot: never ask for bank, card or identity data.
    if (turn.path === "complex" && asksForSensitiveData(reply)) {
      return ok({ path: turn.path, reply: SAFE_HANDOFF_TEXT, stage, adminNote: HANDOFF_NOTE, handoff: true });
    }
    if (turn.fn && turn.path !== "complex") adminNote ??= `(respondió con plantilla: ${turn.fn})`;
    return ok({ path: turn.path, reply: truncateForWhatsApp(reply.trim()), stage, adminNote, handoff });
  } catch (e) {
    // Router errors are classified inside answerTurn (as on WhatsApp): an auth error here also
    // records the agent error and marks the key invalid. Accepted: it is the same, really invalid, key.
    if (isAuthError(e)) return fail("KEY_INVALID", "El proveedor rechazó la API key");
    if (isQuotaExhausted(e)) return fail("QUOTA_EXCEEDED", describeAgentError("QUOTA_EXCEEDED"));
    if (errorCode(e) === "OLLAMA_UNAVAILABLE") return fail("MODEL_ERROR", describeAgentError("OLLAMA_UNAVAILABLE"));
    return fail("MODEL_ERROR", "El modelo no respondió. Probá de nuevo en unos segundos.");
  }
}
