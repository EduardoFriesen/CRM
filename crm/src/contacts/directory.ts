import { and, desc, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { contacts, orders, type Stage } from "@/db/schema";
import { escapeLike } from "@/lib/like";
import { loadViews, type OrderView } from "@/orders/orders";
import { idleConsulta } from "./contacts";

export const PAGE_SIZE = 50;
export const OUTCOMES = ["compro", "venta", "consulta"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export type CustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
  lastMessageAt: Date | null;
  stage: Stage;
  onBoard: boolean;
  outcome: Outcome;
  spent: string;
};

type Params = Record<string, string | string[] | undefined>;
// Bad values in the URL drop that filter instead of failing the page.
const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);
export const pageParam = z.coerce.number().int().min(1).max(10_000).catch(1);
export const textParam = optional(z.string().trim().min(1).max(100));

const customerFilters = z.object({
  q: textParam,
  estado: optional(z.enum(OUTCOMES)),
  tablero: optional(z.enum(["si", "no"])),
  pagina: pageParam,
});
export type CustomerFilters = z.infer<typeof customerFilters>;

export function parseCustomerFilters(params: Params): CustomerFilters {
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);
  const parsed = customerFilters.parse({ q: one("q"), estado: one("estado"), tablero: one("tablero"), pagina: one("pagina") ?? 1 });
  return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined)) as CustomerFilters;
}

// Columns are qualified by hand: drizzle renders bare names inside sql``.
const hasOrder = (status?: string) =>
  sql`exists (select 1 from orders o where o.contact_id = "contacts"."id"${status ? sql` and o.status = ${status}` : sql``})`;
// Compró: a delivered order. Llegó a Venta: handoff/selector stamp, stage, or any order
// (orders are only created in Venta). Contacts from before reached_venta_at existed that
// left Venta without an order count as consulta.
const outcome = sql<Outcome>`case
  when ${hasOrder("delivered")} then 'compro'
  when ${contacts.reachedVentaAt} is not null or ${contacts.stage} in ('venta', 'postventa') or ${hasOrder()} then 'venta'
  else 'consulta' end`;
const onBoard = sql<boolean>`(${contacts.closedAt} is null and not ${idleConsulta})`;

export async function listCustomers(tenantId: string, f: CustomerFilters): Promise<{ rows: CustomerRow[]; hasMore: boolean }> {
  const where: (SQL | undefined)[] = [];
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    where.push(sql`(${contacts.name} ilike ${like} or ${contacts.phone} ilike ${like})`);
  }
  if (f.estado) where.push(sql`${outcome} = ${f.estado}`);
  if (f.tablero) where.push(f.tablero === "si" ? onBoard : sql`not ${onBoard}`);
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: contacts.id,
        name: contacts.name,
        phone: contacts.phone,
        lastMessageAt: contacts.lastMessageAt,
        stage: contacts.stage,
        onBoard,
        outcome,
        spent: sql<string>`(select coalesce(sum(o.total), 0)::text from orders o
          where o.contact_id = "contacts"."id" and o.status = 'delivered')`,
      })
      .from(contacts)
      .where(and(...where))
      .orderBy(sql`${contacts.lastMessageAt} desc nulls last`, desc(contacts.createdAt))
      .limit(PAGE_SIZE + 1)
      .offset((f.pagina - 1) * PAGE_SIZE),
  );
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

// Every order of these customers (any status), newest first, keyed by contact.
export async function listCustomerOrders(tenantId: string, contactIds: string[]): Promise<Map<string, OrderView[]>> {
  const map = new Map<string, OrderView[]>();
  if (contactIds.length === 0) return map;
  const views = await withTenant(tenantId, (tx) =>
    loadViews(tx, inArray(orders.contactId, contactIds), { orderBy: [desc(orders.createdAt)], limit: 5000 }),
  );
  for (const o of views) map.set(o.contactId, [...(map.get(o.contactId) ?? []), o]);
  return map;
}
