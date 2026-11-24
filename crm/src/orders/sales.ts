import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { contacts, orders } from "@/db/schema";
import { escapeLike } from "@/lib/like";
import { optional, PAGE_SIZE, pageParam, parseParams, textParam, type Params } from "@/lib/params";
import { loadViews, type OrderView } from "./orders";

const amount = optional(z.coerce.number().min(0).max(1e10));
const salesFilters = z.object({
  producto: textParam,
  cliente: textParam,
  desde: optional(z.iso.date()),
  hasta: optional(z.iso.date()),
  min: amount,
  max: amount,
  cancelados: z.unknown().transform((v) => v === "si"),
  pagina: pageParam,
});
export type SalesFilters = z.infer<typeof salesFilters>;
export const parseSalesFilters = (params: Params): SalesFilters => parseParams(salesFilters, params);

export type SalesTotals = { count: number; sum: string; avg: string };

// Delivered orders (plus cancelled on request) for the Ventas tab. Totals cover the whole
// filtered result and count only delivered orders: a cancelled order is not a sale.
export async function listSales(
  tenantId: string,
  f: SalesFilters,
): Promise<{ orders: OrderView[]; hasMore: boolean; totals: SalesTotals }> {
  const where: (SQL | undefined)[] = [];
  if (f.producto) {
    // Columns are qualified by hand: drizzle renders bare names inside sql``.
    where.push(sql`exists (select 1 from order_items i where i.order_id = "orders"."id"
      and i.product_name ilike ${`%${escapeLike(f.producto)}%`})`);
  }
  if (f.cliente) {
    const like = `%${escapeLike(f.cliente)}%`;
    where.push(sql`(${contacts.name} ilike ${like} or ${contacts.phone} ilike ${like})`);
  }
  if (f.desde) where.push(sql`${orders.deliveryDate} >= ${f.desde}`);
  if (f.hasta) where.push(sql`${orders.deliveryDate} <= ${f.hasta}`);
  if (f.min !== undefined) where.push(sql`${orders.total} >= ${f.min}`);
  if (f.max !== undefined) where.push(sql`${orders.total} <= ${f.max}`);
  const statuses = f.cancelados ? (["delivered", "cancelled"] as const) : (["delivered"] as const);

  return withTenant(tenantId, async (tx) => {
    const views = await loadViews(tx, and(inArray(orders.status, [...statuses]), ...where), {
      orderBy: [desc(orders.deliveryDate), desc(orders.createdAt)],
      limit: PAGE_SIZE + 1,
      offset: (f.pagina - 1) * PAGE_SIZE,
    });
    const [totals] = await tx
      .select({
        count: sql<number>`count(*)`.mapWith(Number),
        sum: sql<string>`coalesce(sum(${orders.total}), 0)::numeric(14,2)::text`,
        avg: sql<string>`coalesce(avg(${orders.total}), 0)::numeric(14,2)::text`,
      })
      .from(orders)
      .innerJoin(contacts, eq(contacts.id, orders.contactId))
      .where(and(eq(orders.status, "delivered"), ...where));
    return { orders: views.slice(0, PAGE_SIZE), hasMore: views.length > PAGE_SIZE, totals };
  });
}
