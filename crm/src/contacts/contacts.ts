import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { contacts, STAGES, type Stage } from "@/db/schema";
import { fail, ok, type Result } from "@/lib/result";

export type BoardContact = {
  id: string;
  name: string | null;
  phone: string | null;
  lastMessageAt: Date | null;
  lastMessage: string | null;
  botPausedUntil: Date | null;
};
export type Board = Record<Stage, BoardContact[]>;

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
        // Columns are qualified by hand: drizzle renders bare names inside sql``, and an
        // unqualified "id" in this subquery would resolve to messages.id.
        lastMessage: sql<string | null>`(
          select left(m.body, 80) from messages m
          where m.contact_id = "contacts"."id"
          order by m.sent_at desc limit 1)`,
      })
      .from(contacts)
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
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .update(contacts)
      .set({ stage: parsed.data.stage })
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
