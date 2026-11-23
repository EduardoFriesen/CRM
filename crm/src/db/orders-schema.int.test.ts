import { afterAll, describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { orderItems, orders } from "@/db/schema";
import { dropTenants, makeContact, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

async function seedOrder(tenantId: string, quantity = 2) {
  const c = await makeContact(tenantId);
  const [p] = await ownerSql<{ id: string }[]>`insert into products (tenant_id, name, price) values (${tenantId}, 'Pan', 100) returning id`;
  const [o] = await ownerSql<{ id: string }[]>`insert into orders (tenant_id, contact_id, delivery_date, address, total)
    values (${tenantId}, ${c.id}, current_date, 'Calle 1', 200) returning id`;
  await ownerSql`insert into order_items (tenant_id, order_id, product_id, product_name, unit_price, quantity, line_total)
    values (${tenantId}, ${o.id}, ${p.id}, 'Pan', 100, ${quantity}, 200)`;
  return { orderId: o.id, productId: p.id };
}

describe("orders schema", () => {
  it("isolates orders and their items per tenant", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await seedOrder(b.id);
    expect(await withTenant(a.id, (tx) => tx.select().from(orders))).toEqual([]);
    expect(await withTenant(a.id, (tx) => tx.select().from(orderItems))).toEqual([]);
  });

  it("never lets the app delete orders", async () => {
    const a = await makeTenant();
    await seedOrder(a.id);
    await expect(withTenant(a.id, (tx) => tx.delete(orders))).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/permission denied/) },
    });
  });

  it("rejects a zero quantity", async () => {
    const a = await makeTenant();
    await expect(seedOrder(a.id, 0)).rejects.toThrow(/check constraint/);
  });

  it("keeps the line when its product is deleted", async () => {
    const a = await makeTenant();
    const { orderId, productId } = await seedOrder(a.id);
    await ownerSql`delete from products where id = ${productId}`;
    const [line] = await ownerSql<{ product_id: string | null; product_name: string }[]>`
      select product_id, product_name from order_items where order_id = ${orderId}`;
    expect(line).toEqual({ product_id: null, product_name: "Pan" });
  });
});
