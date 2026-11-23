import { expect, test } from "@playwright/test";
import postgres from "postgres";

const sql = postgres(process.env.CRM_TEST_OWNER_URL ?? "", { max: 1, onnotice: () => {} });
const slug = `e2e-usagenav-${Math.random().toString(36).slice(2, 8)}`;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
let tenantId = "";

test.beforeAll(async () => {
  const [t] = await sql<{ id: string }[]>`insert into tenants (slug, name, admin_phone) values (${slug}, 'Nav E2E', '5491100000000') returning id`;
  tenantId = t.id;
  await sql`insert into ai_usage (tenant_id, day, requests) values (${t.id}, ${today}, 5)`;
});
test.afterAll(async () => {
  await sql`delete from tenants where slug = ${slug}`;
  await sql.end();
});

test("the usage bar refreshes when moving between screens", async ({ page }) => {
  await page.goto(`/t/${slug}`);
  const bar = page.getByRole("region", { name: "Consumo de IA" });
  await expect(bar).toContainText("5 pedidos");
  await sql`update ai_usage set requests = 42 where tenant_id = ${tenantId}`;
  await page.getByRole("navigation", { name: "Secciones del negocio" }).getByRole("link", { name: "Catálogo" }).click();
  await expect(page).toHaveURL(/catalogo/);
  await expect(bar).toContainText("42 pedidos");
});
