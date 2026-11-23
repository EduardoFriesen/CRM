import { expect, test } from "@playwright/test";
import postgres from "postgres";

const sql = postgres(process.env.CRM_TEST_OWNER_URL ?? "", { max: 1, onnotice: () => {} });
const slug = `e2e-agent-${Math.random().toString(36).slice(2, 8)}`;

test.beforeAll(async () => {
  await sql`insert into tenants (slug, name, admin_phone) values (${slug}, 'Agente E2E', '5491100000000')`;
});
test.afterAll(async () => {
  await sql`delete from tenants where slug = ${slug}`;
  await sql.end();
});

test("configure the agent; the key is masked and never rendered", async ({ page }) => {
  await page.goto(`/t/${slug}/agente`);
  await expect(page.getByLabel("Encender el bot")).not.toBeChecked();
  await expect(page.getByLabel("Presentarse como asistente virtual")).toBeChecked();

  await page.getByLabel("Nombre del agente").fill("Sofi");
  await page.getByLabel("Proveedor").selectOption("anthropic");
  await page.getByLabel("Modelo").fill("claude-haiku-5-5");
  await page.getByLabel("API key").fill("sk-test-abcd1234");
  await page.getByLabel("Tono y actitud").fill("Cálida, breve, con voseo");
  await page.getByRole("button", { name: "Guardar agente" }).click();

  await expect(page.getByText("••••1234")).toBeVisible();
  await page.reload();
  await expect(page.getByText("••••1234")).toBeVisible();
  expect(await page.content()).not.toContain("sk-test-abcd1234");
  await expect(page.getByLabel("Nombre del agente")).toHaveValue("Sofi");
});
