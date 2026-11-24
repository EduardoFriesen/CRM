import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import { contacts, orderItems, orders, products, type Order, type OrderItem } from "@/db/schema";
import { fail, ok, type Result } from "@/lib/result";
import { todayInBuenosAires } from "./group";

export type OrderView = Order & { contactName: string | null; contactPhone: string | null; items: OrderItem[] };

export const orderInput = z.object({
  contactId: z.uuid(),
  items: z
    .array(
      z.object({
        productId: z.uuid({ error: "Elegí un producto" }),
        quantity: z.coerce.number().int("Cantidad entera").min(1, "Mínimo 1").max(10_000, "Máximo 10.000"),
      }),
    )
    .min(1, "Agregá al menos un producto")
    .max(30, "Máximo 30 productos"),
  deliveryDate: z.iso.date({ error: "Elegí la fecha de entrega" }),
  address: z.string().trim().min(1, "Poné la dirección").max(200, "Máximo 200 caracteres"),
  locality: z.string().trim().max(100, "Máximo 100 caracteres").default(""),
  notes: z.string().trim().max(500, "Máximo 500 caracteres").default(""),
});

class OutOfStock extends Error {
  constructor(
    readonly productId: string,
    readonly productName: string,
    readonly left: number,
  ) {
    super("out of stock");
  }
}

const money = (n: number) => n.toFixed(2);

// Orders with their contact and items. Default order: next delivery first.
export async function loadViews(
  tx: Tx,
  where: SQL | undefined,
  { orderBy = [asc(orders.deliveryDate), asc(orders.createdAt)], limit = 1000, offset = 0 }: { orderBy?: SQL[]; limit?: number; offset?: number } = {},
): Promise<OrderView[]> {
  const rows = await tx
    .select({ order: orders, contactName: contacts.name, contactPhone: contacts.phone })
    .from(orders)
    .innerJoin(contacts, eq(contacts.id, orders.contactId))
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);
  if (rows.length === 0) return [];
  const items = await tx
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, rows.map((r) => r.order.id)))
    .orderBy(asc(orderItems.productName));
  return rows.map((r) => ({
    ...r.order,
    contactName: r.contactName,
    contactPhone: r.contactPhone,
    items: items.filter((i) => i.orderId === r.order.id),
  }));
}

export function listOrders(tenantId: string, opts: { closed: boolean }): Promise<OrderView[]> {
  return withTenant(tenantId, (tx) =>
    loadViews(
      tx,
      opts.closed ? sql`${orders.status} <> 'pending'` : eq(orders.status, "pending"),
      opts.closed ? { orderBy: [desc(orders.createdAt)], limit: 50 } : {},
    ),
  );
}

// Creates the order and takes the stock in one transaction: each product's stock is
// decremented with a conditional UPDATE, so concurrent orders can never oversell.
export async function createOrder(tenantId: string, input: unknown): Promise<Result<OrderView>> {
  const parsed = orderInput.safeParse(input);
  if (!parsed.success) return fail("VALIDATION", "Revisá el pedido", z.flattenError(parsed.error).fieldErrors);
  const data = parsed.data;
  if (data.deliveryDate < todayInBuenosAires()) {
    return fail("VALIDATION", "Revisá el pedido", { deliveryDate: ["La fecha de entrega no puede ser anterior a hoy"] });
  }
  const qty = new Map<string, number>();
  for (const i of data.items) qty.set(i.productId, (qty.get(i.productId) ?? 0) + i.quantity);

  try {
    return await withTenant(tenantId, async (tx) => {
      const [contact] = await tx.select({ stage: contacts.stage }).from(contacts).where(eq(contacts.id, data.contactId));
      if (!contact) return fail<OrderView>("NOT_FOUND", "No encontramos ese cliente");
      if (contact.stage !== "venta") return fail<OrderView>("VALIDATION", "Solo se crean pedidos para clientes en Venta");

      const found = await tx
        .select()
        .from(products)
        .where(and(inArray(products.id, [...qty.keys()]), eq(products.active, true)));
      if (found.length !== qty.size) return fail<OrderView>("NOT_FOUND", "Algún producto no existe o está pausado");

      for (const p of found) {
        const q = qty.get(p.id)!;
        if (p.stock === null) continue;
        const taken = await tx
          .update(products)
          .set({ stock: sql`${products.stock} - ${q}` })
          .where(and(eq(products.id, p.id), sql`${products.stock} >= ${q}`))
          .returning({ id: products.id });
        if (taken.length === 0) {
          const [now] = await tx.select({ stock: products.stock }).from(products).where(eq(products.id, p.id));
          throw new OutOfStock(p.id, p.name, now?.stock ?? 0);
        }
      }

      const lines = found.map((p) => {
        const q = qty.get(p.id)!;
        return {
          productId: p.id,
          productName: p.name,
          unitPrice: p.price,
          quantity: q,
          lineTotal: money(Number(p.price) * q),
          stockTaken: p.stock !== null,
        };
      });
      const total = money(lines.reduce((sum, l) => sum + Number(l.lineTotal), 0));
      const [order] = await tx
        .insert(orders)
        .values({
          tenantId,
          contactId: data.contactId,
          deliveryDate: data.deliveryDate,
          address: data.address,
          locality: data.locality,
          notes: data.notes,
          total,
        })
        .returning({ id: orders.id });
      await tx.insert(orderItems).values(lines.map((l) => ({ ...l, tenantId, orderId: order.id })));
      const [view] = await loadViews(tx, eq(orders.id, order.id));
      return ok(view);
    });
  } catch (e) {
    if (e instanceof OutOfStock) {
      return fail("OUT_OF_STOCK", `No hay stock suficiente de ${e.productName} (quedan ${e.left})`, { productId: e.productId });
    }
    throw e;
  }
}

const orderId = z.uuid();
const NOT_PENDING = "Ese pedido ya no está pendiente";

export async function deliverOrder(tenantId: string, id: string): Promise<Result<OrderView>> {
  if (!orderId.safeParse(id).success) return fail("NOT_FOUND", "No encontramos ese pedido");
  return withTenant(tenantId, async (tx) => {
    const [o] = await tx
      .update(orders)
      .set({ status: "delivered", deliveredAt: sql`now()` })
      .where(and(eq(orders.id, id), eq(orders.status, "pending")))
      .returning({ id: orders.id, contactId: orders.contactId });
    if (!o) return fail<OrderView>("VALIDATION", NOT_PENDING);
    // Delivered: the customer is in postventa and the bot takes the chat back from the handoff.
    await tx.update(contacts).set({ stage: "postventa", botPausedUntil: null }).where(eq(contacts.id, o.contactId));
    const [view] = await loadViews(tx, eq(orders.id, o.id));
    return ok(view);
  });
}

export async function cancelOrder(tenantId: string, id: string): Promise<Result<OrderView>> {
  if (!orderId.safeParse(id).success) return fail("NOT_FOUND", "No encontramos ese pedido");
  return withTenant(tenantId, async (tx) => {
    // The status guard makes a double cancel a no-op, so stock comes back exactly once.
    const [o] = await tx
      .update(orders)
      .set({ status: "cancelled", cancelledAt: sql`now()` })
      .where(and(eq(orders.id, id), eq(orders.status, "pending")))
      .returning({ id: orders.id });
    if (!o) return fail<OrderView>("VALIDATION", NOT_PENDING);
    const lines = await tx
      .select({ productId: orderItems.productId, quantity: orderItems.quantity })
      .from(orderItems)
      .where(and(eq(orderItems.orderId, o.id), isNotNull(orderItems.productId), eq(orderItems.stockTaken, true)));
    for (const l of lines) {
      await tx
        .update(products)
        .set({ stock: sql`${products.stock} + ${l.quantity}` })
        .where(and(eq(products.id, l.productId!), isNotNull(products.stock)));
    }
    const [view] = await loadViews(tx, eq(orders.id, o.id));
    return ok(view);
  });
}
