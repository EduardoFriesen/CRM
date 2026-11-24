import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import { contacts, STAGES, type Stage } from "@/db/schema";
import { fail, ok, type Result } from "@/lib/result";

export type BoardContact = {
  id: string;
  name: string | null;
  phone: string | null;
  lastMessageAt: Date | null;
  lastMessage: string | null;
  botPausedUntil: Date | null;
  hasDeliveredOrder: boolean;
};
export type Board = Record<Stage, BoardContact[]>;

// A consulta nobody wrote in for longer than the tenant's consulta_idle_days: off the board,
// and a new conversation if the customer writes again. A filter, not a job: changing the
// setting applies at once, also to contacts already hidden.
// A contact without messages (last_message_at null) is not idle.
export const idleConsulta = sql`coalesce(${contacts.stage} = 'consulta' and ${contacts.lastMessageAt} < now() - make_interval(days => (
  select t.consulta_idle_days from tenants t where t.id = ${contacts.tenantId})), false)`;

export async function listBoard(tenantId: string): Promise<Board> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: contacts.id,
        name: contacts.name,
        phone: contacts.phone,
        stage: contacts.stage,
        lastMessageAt: contacts.lastMessageAt,
        botPausedUntil: contacts.botPausedUntil,
        hasDeliveredOrder: sql<boolean>`exists (
          select 1 from orders o where o.contact_id = "contacts"."id" and o.status = 'delivered')`,
        // Columns are qualified by hand: drizzle renders bare names inside sql``, and an
        // unqualified "id" in this subquery would resolve to messages.id.
        lastMessage: sql<string | null>`(
          select left(m.body, 80) from messages m
          where m.contact_id = "contacts"."id"
          order by m.sent_at desc limit 1)`,
      })
      .from(contacts)
      .where(and(isNull(contacts.closedAt), sql`not ${idleConsulta}`))
      .orderBy(sql`${contacts.lastMessageAt} desc nulls last`, desc(contacts.createdAt)),
  );
  const board: Board = { consulta: [], venta: [], postventa: [] };
  for (const { stage, ...contact } of rows) board[stage].push(contact);
  return board;
}

const stageChange = z.object({ contactId: z.uuid(), stage: z.enum(STAGES) });

export async function setContactStage(
  tenantId: string,
  contactId: string,
  stage: unknown,
): Promise<Result<{ id: string; stage: Stage }>> {
  const parsed = stageChange.safeParse({ contactId, stage });
  if (!parsed.success) return fail("VALIDATION", "Etapa inválida", z.flattenError(parsed.error).fieldErrors);
  if (parsed.data.stage === "postventa") {
    // Postventa means the customer received an order (also enforced for the bot's set_stage).
    const [delivered] = await withTenant(tenantId, (tx) =>
      tx.execute(sql`select 1 from orders where contact_id = ${parsed.data.contactId} and status = 'delivered' limit 1`),
    );
    if (!delivered) {
      return fail("NEEDS_DELIVERED_ORDER", "Para pasar a Postventa el cliente necesita un pedido entregado");
    }
  }
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .update(contacts)
      .set({
        stage: parsed.data.stage,
        ...(parsed.data.stage === "venta" && { reachedVentaAt: sql`coalesce(${contacts.reachedVentaAt}, now())` }),
      })
      .where(and(eq(contacts.id, parsed.data.contactId), eq(contacts.tenantId, tenantId)))
      .returning({ id: contacts.id, stage: contacts.stage }),
  );
  return row ? ok(row) : fail("NOT_FOUND", "No encontramos ese cliente");
}

const contactId = z.uuid();

export async function reactivateBot(tenantId: string, id: string): Promise<Result<{ id: string }>> {
  if (!contactId.safeParse(id).success) return fail("NOT_FOUND", "No encontramos ese cliente");
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .update(contacts)
      .set({ botPausedUntil: null })
      .where(and(eq(contacts.id, id), eq(contacts.tenantId, tenantId)))
      .returning({ id: contacts.id }),
  );
  return row ? ok(row) : fail("NOT_FOUND", "No encontramos ese cliente");
}

// Takes a finished conversation off the board: Postventa ("Cerrar venta") or Consulta (×).
// Venta stays until the admin moves it. Nothing is deleted.
export async function closeContact(tenantId: string, id: string): Promise<Result<{ id: string }>> {
  if (!contactId.safeParse(id).success) return fail("NOT_FOUND", "No encontramos ese cliente");
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .update(contacts)
      .set({ closedAt: sql`now()` })
      .where(
        and(
          eq(contacts.id, id),
          eq(contacts.tenantId, tenantId),
          inArray(contacts.stage, ["consulta", "postventa"]),
          isNull(contacts.closedAt),
        ),
      )
      .returning({ id: contacts.id });
    if (row) return ok(row);
    const [exists] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, id));
    return exists
      ? fail("NOT_CLOSABLE", "Solo se sacan del tablero clientes en Consulta o Postventa")
      : fail("NOT_FOUND", "No encontramos ese cliente");
  });
}

// A customer writing to a contact that left the board (closed, or an idle consulta) starts
// a new conversation: back to Consulta, bot unpaused, history from now. Call it before the
// webhook's upsert bumps last_message_at, and only for the customer's own messages.
// `at` is that message's time: the conversation starts with it (WhatsApp timestamps have
// second precision, so now() would leave the message itself out of the history).
export async function reopenContact(tx: Tx, tenantId: string, jid: string, at: Date): Promise<void> {
  await tx
    .update(contacts)
    .set({ closedAt: null, reopenedAt: at, stage: "consulta", botPausedUntil: null })
    .where(
      and(
        eq(contacts.tenantId, tenantId),
        eq(contacts.jid, jid),
        sql`(${contacts.closedAt} is not null or ${idleConsulta})`,
      ),
    );
}
