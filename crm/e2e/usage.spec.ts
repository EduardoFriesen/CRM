import { expect, test } from "@playwright/test";
import postgres from "postgres";

const sql = postgres(process.env.CRM_TEST_OWNER_URL ?? "", { max: 1, onnotice: () => {} });
const slug = `e2e-usage-${Math.random().toString(36).slice(2, 8)}`;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

test.beforeAll(async () => {
  const [t] = await sql<{ id: string }[]>`insert into tenants (slug, name, admin_phone) values (${slug}, 'Uso E2E', '5491100000000') returning id`;
  await sql`insert into agent_configs (tenant_id, agent_name, provider, model, api_key_enc, api_key_last4, daily_request_limit)
    values (${t.id}, 'Sofi', 'google', 'gemini-3.5-flash', 'x', '1234', 1000)`;
  await sql`insert into ai_usage (tenant_id, day, requests, input_tokens, output_tokens, replies) values (${t.id}, ${today}, 800, 20000, 4310, 9)`;
});
test.afterAll(async () => {
  await sql`delete from tenants where slug = ${slug}`;
  await sql.end();
});

test("the usage bar is on every tenant screen and warns near the limit", async ({ page }) => {
  for (const path of [`/t/${slug}`, `/t/${slug}/catalogo`]) {
    await page.goto(path);
    const bar = page.getByRole("region", { name: "Consumo de IA" });
    await expect(bar).toContainText("IA hoy");
    await expect(bar).toContainText("800 pedidos");
    await expect(bar).toContainText("24.310 tokens");
    await expect(bar).toContainText("800 de 1.000 pedidos");
    await expect(bar).toContainText("Cerca del límite");
  }
});
