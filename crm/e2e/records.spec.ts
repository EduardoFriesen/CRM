import { expect, test } from "@playwright/test";
import postgres from "postgres";

const sql = postgres(process.env.CRM_TEST_OWNER_URL ?? "", { max: 1, onnotice: () => {} });
const slug = `e2e-rec-${Math.random().toString(36).slice(2, 8)}`;

test.beforeAll(async () => {
  const [t] = await sql<{ id: string }[]>`
    insert into tenants (slug, name, admin_phone) values (${slug}, 'Registros E2E', '5491100000000') returning id`;
  const [ana] = await sql<{ id: string }[]>`insert into contacts (tenant_id, jid, phone, name, stage, last_message_at, closed_at)
    values (${t.id}, '5491133330001@s.whatsapp.net', '5491133330001', 'Ana', 'postventa', now(), now()) returning id`;
  await sql`insert into contacts (tenant_id, jid, phone, name, last_message_at)
    values (${t.id}, '5491133330002@s.whatsapp.net', '5491133330002', 'Bruno', now() - interval '1 hour')`;
  await sql`insert into contacts (tenant_id, jid, last_message_at) values (${t.id}, '77665544@lid', now() - interval '2 hours')`;
  const [o] = await sql<{ id: string }[]>`insert into orders (tenant_id, contact_id, status, delivery_date, address, total, delivered_at)
    values (${t.id}, ${ana.id}, 'delivered', '2026-11-10', 'Calle 1', 5000, now()) returning id`;
  await sql`insert into order_items (tenant_id, order_id, product_name, unit_price, quantity, line_total)
    values (${t.id}, ${o.id}, 'Pan de campo', 2500, 2, 5000)`;
});
test.afterAll(async () => {
  await sql`delete from tenants where slug = ${slug}`;
  await sql.end();
});

test("the nav separates the board from the records", async ({ page }) => {
  await page.goto(`/t/${slug}`);
  const nav = page.getByRole("navigation", { name: "Secciones del negocio" });
  for (const name of ["Tablero", "Clientes", "Ventas"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Tablero" })).toBeVisible();
  await expect(page.getByText("Ver entregados y cancelados")).toHaveCount(0);
});

test("Clientes lists everyone with how far they got, and opens a purchase history", async ({ page }) => {
  await page.goto(`/t/${slug}/clientes`);
  const ana = page.getByRole("group").filter({ hasText: "Ana" });
  await expect(ana).toContainText("Compró");
  await expect(ana).toContainText("Fuera del tablero");
  await expect(page.getByRole("group").filter({ hasText: "Bruno" })).toContainText("Nunca pasó de Consulta");
  await expect(page.getByRole("group").filter({ hasText: "Sin nombre" })).toHaveCount(1);
  await ana.locator("summary").click();
  await expect(ana).toContainText("Pan de campo");
  await expect(ana).toContainText("Total gastado $5.000");
});

test("Clientes filters by text and outcome", async ({ page }) => {
  await page.goto(`/t/${slug}/clientes`);
  await page.getByLabel("Buscar").fill("bru");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/q=bru/);
  await expect(page.getByRole("group")).toHaveCount(1);
  await page.getByRole("link", { name: "Limpiar filtros" }).click();
  await page.getByLabel("Estado").selectOption("compro");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByRole("group")).toHaveCount(1);
  await expect(page.getByRole("group")).toContainText("Ana");
});

test("Ventas shows delivered sales with totals and filters them", async ({ page }) => {
  await page.goto(`/t/${slug}/ventas`);
  await expect(page.getByRole("article").filter({ hasText: "Pan de campo" })).toBeVisible();
  const totals = page.getByLabel("Totales de las ventas filtradas");
  await expect(totals).toContainText("1 venta");
  await expect(totals).toContainText("Total $5.000");
  await page.getByLabel("Producto").fill("kikuyo");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByText("Ningún resultado con estos filtros")).toBeVisible();
  await page.getByRole("link", { name: "Limpiar filtros" }).click();
  await expect(page.getByRole("article").filter({ hasText: "Pan de campo" })).toBeVisible();
});
