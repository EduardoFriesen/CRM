import { tool } from "ai";
import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAgentError } from "@/agent/config";
import { searchCatalog } from "@/catalog/catalog";
import { setContactStage } from "@/contacts/contacts";
import { withTenant } from "@/db/client";
import { contacts, escalations, STAGES, type Stage } from "@/db/schema";
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
      execute: async ({ query }) => ({ products: await searchCatalog(tenantId, query) }),
    }),
    set_stage: tool({
      description: "Mueve al cliente a la etapa de la conversación: consulta, venta o postventa.",
      inputSchema: z.object({ stage: z.enum(STAGES) }),
      execute: async ({ stage }) => {
        opts.onStage?.(stage);
        if (opts.dryRun) return { ok: true };
        const r = await setContactStage(tenantId, contactId, stage);
        return { ok: r.success };
      },
    }),
    ask_admin: tool({
      description:
        "Le consulta al administrador del negocio un dato que no tenés. Después decile al cliente que lo consultás y le avisás.",
      inputSchema: z.object({
        question: z.string().trim().min(1).max(500).describe("La pregunta, sin datos personales del cliente"),
        is_price: z.boolean().describe("true si es sobre precios, costos, descuentos o recargos"),
      }),
      execute: async ({ question, is_price }) => {
        if (opts.dryRun) {
          opts.onAdmin?.("ask", question);
          return { ok: true };
        }
        if (!opts.notify) return FALLBACK;
        const [{ pending }] = await withTenant(tenantId, (tx) =>
          tx
            .select({ pending: count() })
            .from(escalations)
            .where(and(eq(escalations.contactId, contactId), eq(escalations.status, "pending"))),
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
            .values({ tenantId, contactId, question, isPrice: is_price, adminMessageId: sent.id })
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
            .set({ stage: "venta", botPausedUntil: sql`now() + make_interval(hours => ${hours})` })
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
