import { expect, test } from "@playwright/test";
import postgres from "postgres";

const sql = postgres(process.env.CRM_TEST_OWNER_URL ?? "", { max: 1, onnotice: () => {} });
const suffix = Math.random().toString(36).slice(2, 8);
const slug = `e2e-orders-${suffix}`;
const emptySlug = `e2e-orders-empty-${suffix}`;
let panId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const [t] = await sql<{ id: string }[]>`insert into tenants (slug, name, admin_phone) values (${slug}, 'Pedidos E2E', '5491100000000') returning id`;
  await sql`insert into tenants (slug, name, admin_phone) values (${emptySlug}, 'Vacío E2E', '5491100000000')`;
  const [p] = await sql<{ id: string }[]>`insert into products (tenant_id, name, price, stock) values (${t.id}, 'Pan de campo', 2500, 10) returning id`;
  panId = p.id;
  await sql`insert into contacts (tenant_id, jid, phone, name, stage, last_message_at) values (${t.id}, '5491122330001@s.whatsapp.net', '5491122330001', 'Ana', 'venta', now())`;
  await sql`insert into contacts (tenant_id, jid, phone, name, stage, last_message_at) values (${t.id}, '5491122330002@s.whatsapp.net', '5491122330002', 'Bruno', 'consulta', now())`;
});
test.afterAll(async () => {
  await sql`delete from tenants where slug in (${slug}, ${emptySlug})`;
  await sql.end();
});

const stock = async () => (await sql<{ stock: number }[]>`select stock from products where id = ${panId}`)[0].stock;
const card = (page: import("@playwright/test").Page, name: string) => page.getByRole("article").filter({ hasText: name });

test("only customers in venta can get an order, and postventa needs a delivered one", async ({ page }) => {
  await page.goto(`/t/${slug}`);
  await expect(card(page, "Ana").getByRole("button", { name: /Crear pedido/ })).toBeVisible();
  await expect(card(page, "Bruno").getByRole("button", { name: /Crear pedido/ })).toHaveCount(0);
  await expect(page.getByLabel("Etapa de Ana").locator("option", { hasText: "Postventa (requiere pedido entregado)" })).toBeDisabled();
});

test("an order that exceeds the stock is refused and keeps what was typed", async ({ page }) => {
  await page.goto(`/t/${slug}`);
  await card(page, "Ana").getByRole("button", { name: /Crear pedido/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Producto 1").selectOption({ label: "Pan de campo · $2.500 · stock 10" });
  await dialog.getByLabel("Cantidad 1").fill("50");
  await dialog.getByLabel("Dirección").fill("Av. Siempre Viva 742");
  await dialog.getByRole("button", { name: "Guardar pedido" }).click();
  await expect(dialog.getByText("No hay stock suficiente de Pan de campo (quedan 10)")).toBeVisible();
  await expect(dialog.getByLabel("Dirección")).toHaveValue("Av. Siempre Viva 742");
  expect(await stock()).toBe(10);
});

test("creating, delivering and cancelling orders", async ({ page }) => {
  await page.goto(`/t/${slug}`);
  await card(page, "Ana").getByRole("button", { name: /Crear pedido/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Producto 1").selectOption({ label: "Pan de campo · $2.500 · stock 10" });
  await dialog.getByLabel("Cantidad 1").fill("2");
  await dialog.getByLabel("Dirección").fill("Av. Siempre Viva 742");
  await expect(dialog.getByText("Total $5.000")).toBeVisible();
  await dialog.getByRole("button", { name: "Guardar pedido" }).click();

  const orders = page.getByRole("region", { name: /Pedidos/ });
  const order = orders.getByRole("article").filter({ hasText: "Ana" });
  await expect(order).toContainText("$5.000");
  await expect(orders.getByRole("heading", { name: /Hoy|Mañana|Próximos/ }).first()).toBeVisible();
  expect(await stock()).toBe(8);

  await order.getByRole("button", { name: /Marcar entregado/ }).click();
  await expect(page.getByRole("region", { name: /^Postventa/ }).getByText("Ana")).toBeVisible();

  await sql`update contacts set stage = 'venta' where name = 'Ana' and tenant_id = (select id from tenants where slug = ${slug})`;
  await page.reload();
  await card(page, "Ana").getByRole("button", { name: /Crear pedido/ }).click();
  await dialog.getByLabel("Producto 1").selectOption({ label: "Pan de campo · $2.500 · stock 8" });
  await dialog.getByLabel("Cantidad 1").fill("3");
  await dialog.getByLabel("Dirección").fill("Otra 1");
  await dialog.getByRole("button", { name: "Guardar pedido" }).click();
  await expect.poll(stock).toBe(5);
  const second = orders.getByRole("article").filter({ hasText: "Otra 1" });
  await second.getByRole("button", { name: /^Cancelar/ }).click();
  await second.getByRole("button", { name: /Confirmar cancelación/ }).click();
  await expect.poll(stock).toBe(8);
});

test("explains where orders come from when there are none", async ({ page }) => {
  await page.goto(`/t/${emptySlug}`);
  await expect(page.getByText("Todavía no hay pedidos. Se crean desde un cliente en Venta.")).toBeVisible();
});
