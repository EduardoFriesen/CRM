import { tool } from "ai";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAgentError } from "@/agent/config";
import { searchCatalog } from "@/catalog/catalog";
import { withTenant } from "@/db/client";
import { contacts, escalations, type Stage } from "@/db/schema";
import { escalationText, handoffText } from "./admin-messages";

const MAX_PENDING_PER_CONTACT = 3;
const FALLBACK = { ok: false, fallback: "no tengo ese dato, te lo confirma alguien del equipo" };

export type ToolOptions = {
  dryRun: boolean;
  onStage?: (stage: Stage) => void;
  onAdmin?: (kind: "ask" | "handoff", text: string) => void;
  /** Sends a WhatsApp message to the tenant's admin; returns its id. */
  notify?: (text: string) => Promise<{ id: string }>;
  scheduleReminder?: (escalationId: string) => Promise<void>;
  pauseHours?: number;
};

async function contactInfo(tenantId: string, contactId: string) {
  const [c] = await withTenant(tenantId, (tx) =>
    tx.select({ name: contacts.name, phone: contacts.phone }).from(contacts).where(eq(contacts.id, contactId)),
  );
  return c ?? { name: null, phone: null };
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
            .set({ stage: "consulta" })
            .where(and(eq(contacts.id, contactId), eq(contacts.stage, "postventa")))
            .returning({ id: contacts.id }),
        );
        return moved.length > 0 ? { ok: true } : { ok: false, reason: "Solo se vuelve a Consulta desde Postventa" };
      },
    }),
    ask_admin: tool({
      description:
        "Le consulta al administrador del negocio un dato que no tenés. Después decile al cliente que lo consultás y le avisás.",
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
    handoff_to_admin: tool({
      description:
        "Pasa la conversación a una persona del equipo cuando el cliente quiere cerrar la compra. Después decile que lo atiende alguien del equipo.",
      inputSchema: z.object({ reason: z.string().trim().min(1).max(300).describe("Resumen breve de lo que quiere el cliente") }),
      execute: async ({ reason }) => {
        if (opts.dryRun) {
          opts.onAdmin?.("handoff", reason);
          return { ok: true };
        }
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
        return { ok: true };
      },
    }),
  };
}
