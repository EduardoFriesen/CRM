import { tool } from "ai";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAgentError } from "@/agent/config";
import { searchCatalog } from "@/catalog/catalog";
import { withTenant } from "@/db/client";
import { contacts, escalations, type Stage } from "@/db/schema";
import { attentionText, escalationText, handoffText } from "./admin-messages";
import { answerFaq } from "./faq/answers";
import { LEARNABLE, saveExample } from "./faq/examples";
import { allowedIn, isComplaint, namesOtherDetail } from "./faq/scope";

const MAX_PENDING_PER_CONTACT = 3;
const FALLBACK = { ok: false, fallback: "no tengo ese dato, te lo confirma alguien del equipo" };

export type ToolOptions = {
  dryRun: boolean;
  onStage?: (stage: Stage) => void;
  onAdmin?: (kind: "ask" | "handoff", text: string) => void;
  /** Called once handoff_to_admin has run (also in dry run), so the reply is stored as a handoff. */
  onHandoff?: () => void;
  /** Sends a WhatsApp message to the tenant's admin; returns its id. */
  notify?: (text: string) => Promise<{ id: string }>;
  scheduleReminder?: (escalationId: string) => Promise<void>;
  pauseHours?: number;
  /** For mark_faq: the customer's messages this turn answers, the stage and the numbered learned facts. */
  customerText?: string;
  stage?: Stage;
  facts?: { id: string; question: string }[];
};

async function contactInfo(tenantId: string, contactId: string) {
  const [c] = await withTenant(tenantId, (tx) =>
    tx.select({ name: contacts.name, phone: contacts.phone }).from(contacts).where(eq(contacts.id, contactId)),
  );
  return c ?? { name: null, phone: null };
}

// Moves the customer to Venta, pauses the bot in this chat and tells the admin. Used by the
// handoff_to_admin tool and by the reply guard when the model asks for sensitive data.
export async function handOff(
  tenantId: string,
  contactId: string,
  reason: string,
  opts: Pick<ToolOptions, "notify" | "pauseHours">,
): Promise<void> {
  const hours = opts.pauseHours ?? 12;
  await withTenant(tenantId, (tx) =>
    tx
      .update(contacts)
      .set({
        stage: "venta",
        botPausedUntil: sql`now() + make_interval(hours => ${hours})`,
        reachedVentaAt: sql`coalesce(${contacts.reachedVentaAt}, now())`,
      })
      .where(eq(contacts.id, contactId)),
  );
  try {
    await opts.notify?.(handoffText(await contactInfo(tenantId, contactId), reason));
  } catch {
    await recordAgentError(tenantId, "HANDOFF_NOTIFY");
  }
}

// A person must step in without a sale (stock shortfall, complaint, asks for someone): the
// stage stays, the bot goes off until turned back on, the card turns red and the admin hears.
export async function requestAttention(
  tenantId: string,
  contactId: string,
  reason: string,
  opts: Pick<ToolOptions, "notify">,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.update(contacts).set({ botOff: true, attentionReason: reason.trim().slice(0, 300), attentionAt: sql`now()` }).where(eq(contacts.id, contactId)),
  );
  try {
    await opts.notify?.(attentionText(await contactInfo(tenantId, contactId), reason));
  } catch {
    await recordAgentError(tenantId, "HANDOFF_NOTIFY");
  }
}

export function makeTools(tenantId: string, contactId: string, opts: ToolOptions) {
  return {
    search_catalog: tool({
      description:
        "Busca productos activos del negocio por nombre o descripción. Devuelve nombre, descripción, precio y disponibilidad.",
      inputSchema: z.object({ query: z.string().max(200).describe("Palabras a buscar; vacío lista los primeros productos") }),
      execute: async ({ query }) => {
        const products = await searchCatalog(tenantId, query);
        if (products.length > 0 || !query.trim()) return { products };
        // Customers ask by category ("césped", "panificados") while catalogs name products: an
        // empty result made the model say "no tenemos". Show what exists instead.
        const all = await searchCatalog(tenantId, "");
        if (all.length === 0) return { products: all };
        return { products: all, note: `Ningún producto coincide con "${query}". Este es el catálogo completo: respondé con lo que hay.` };
      },
    }),
    set_stage: tool({
      // Venta comes from handoff_to_admin and Postventa from a delivered order: the only
      // move the bot makes on its own is reopening a customer as consulta.
      description: "Vuelve a poner al cliente en Consulta cuando, estando en Postventa, quiere volver a comprar.",
      // enum (not literal): providers like Gemini understand JSON-schema enum, not const.
      inputSchema: z.object({ stage: z.enum(["consulta"]) }),
      execute: async ({ stage }) => {
        opts.onStage?.(stage);
        if (opts.dryRun) return { ok: true };
        // Enforced here, not only in the prompt: a card in Venta (handoff) must never be
        // demoted, even if the model also calls handoff_to_admin in the same step.
        const moved = await withTenant(tenantId, (tx) =>
          tx
            .update(contacts)
            .set({ stage: "consulta", consultaSince: sql`now()` })
            .where(and(eq(contacts.id, contactId), eq(contacts.stage, "postventa")))
            .returning({ id: contacts.id }),
        );
        return moved.length > 0 ? { ok: true } : { ok: false, reason: "Solo se vuelve a Consulta desde Postventa" };
      },
    }),
    ask_admin: tool({
      // Spelled out: with "un dato que no tenés", models counted their general knowledge as
      // having it and answered care questions themselves (qwen3:8b: 0/6 calls).
      description:
        "Le consulta al administrador del negocio cualquier cosa que no esté en el catálogo ni en la información del negocio: cuidados, uso, instalación, envíos, descuentos, disponibilidad futura u otra duda. Usala aunque creas saber la respuesta. Después decile al cliente que lo consultás y le avisás.",
      inputSchema: z.object({
        question: z.string().trim().min(1).max(500).describe("La pregunta, sin datos personales del cliente"),
        is_price: z.boolean().describe("true si es sobre precios, costos, descuentos o recargos"),
        general: z
          .boolean()
          .describe("false si la respuesta depende de este cliente (su pedido, su reserva, su envío); true si sirve para cualquiera"),
      }),
      execute: async ({ question, is_price, general }) => {
        if (opts.dryRun) {
          opts.onAdmin?.("ask", question);
          return { ok: true };
        }
        if (!opts.notify) return FALLBACK;
        const [{ pending }] = await withTenant(tenantId, (tx) =>
          tx
            .select({ pending: count() })
            .from(escalations)
            // Questions older than 48 h no longer block new ones (the admin may never answer).
            .where(
              and(
                eq(escalations.contactId, contactId),
                eq(escalations.status, "pending"),
                gt(escalations.createdAt, sql`now() - interval '48 hours'`),
              ),
            ),
        );
        if (pending >= MAX_PENDING_PER_CONTACT) return FALLBACK;
        let sent: { id: string };
        try {
          sent = await opts.notify(escalationText(await contactInfo(tenantId, contactId), question));
        } catch {
          return FALLBACK;
        }
        const [esc] = await withTenant(tenantId, (tx) =>
          tx
            .insert(escalations)
            .values({ tenantId, contactId, question, isPrice: is_price, isGeneral: general, adminMessageId: sent.id })
            .returning({ id: escalations.id }),
        );
        // A missing reminder must not undo a question the admin already received.
        await opts.scheduleReminder?.(esc.id).catch(() => recordAgentError(tenantId, "REMINDER_SCHEDULE"));
        return { ok: true };
      },
    }),
    mark_faq: tool({
      description:
        "Si el ÚLTIMO mensaje del cliente se respondía solo con horarios, dirección, medios de pago, envíos, un saludo, una despedida, el catálogo, el estado de su pedido o una respuesta aprendida (fact = su número), llamala además de responder. Si hacía falta algo más, no la llames.",
      inputSchema: z.object({ fn: z.enum(LEARNABLE), fact: z.number().int().min(1).optional() }),
      // Saves a shortcut only when that cheap function really answers this customer now. Never
      // fails the reply: the model always gets ok.
      execute: async ({ fn, fact }) => {
        if (opts.dryRun || !opts.customerText || !opts.stage || !allowedIn(opts.stage, fn)) return { ok: true };
        try {
          // Same guards as the router: a shortcut is answered with no model at all.
          const learned = fn === "learned" ? opts.facts?.[(fact ?? 0) - 1] : undefined;
          if (fn === "learned" && (!learned || namesOtherDetail(opts.customerText, learned.question))) return { ok: true };
          if (fn === "order_status" && isComplaint(opts.customerText)) return { ok: true };
          const factId = learned?.id;
          const answer = await answerFaq(tenantId, { fn, args: factId ? { factId } : {} }, undefined, contactId);
          if (answer !== null) await saveExample(tenantId, { text: opts.customerText, fn, factId });
        } catch (e) {
          console.error(`mark_faq failed: ${String((e as { code?: unknown } | null)?.code ?? (e as Error | null)?.name ?? "unknown")}`);
        }
        return { ok: true };
      },
    }),
    handoff_to_admin: tool({
      description:
        "Pasa la conversación a una persona del equipo cuando el cliente quiere cerrar la compra. Después decile que lo atiende alguien del equipo.",
      inputSchema: z.object({ reason: z.string().trim().min(1).max(300).describe("Resumen breve de lo que quiere el cliente") }),
      execute: async ({ reason }) => {
        opts.onHandoff?.();
        if (opts.dryRun) {
          opts.onAdmin?.("handoff", reason);
          return { ok: true };
        }
        await handOff(tenantId, contactId, reason, opts);
        return { ok: true };
      },
    }),
  };
}
