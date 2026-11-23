import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const sql = postgres(process.env.CRM_TEST_OWNER_URL ?? "", { max: 1, onnotice: () => {} });
const suffix = Math.random().toString(36).slice(2, 8);
const slug = `e2e-res-${suffix}`;

test.beforeAll(async () => {
  const [t] = await sql<{ id: string }[]>`
    insert into tenants (slug, name, admin_phone) values (${slug}, 'Resiliencia', '5491100000000') returning id`;
  await sql`insert into contacts (tenant_id, jid, phone, name, last_message_at)
    values (${t.id}, '5491122000000@s.whatsapp.net', '5491122000000', 'Clara', now())`;
});
test.afterAll(async () => {
  await sql`delete from tenants where slug = ${slug} or slug like 'e2e-form-%'`;
  await sql.end();
});

// Server actions are POSTs to the page URL; answering them with a 500 simulates a server failure.
// (Aborting the request makes Next fall back to a hard navigation, which hides the UI state.)
const failActions = (page: Page) =>
  page.route("**/*", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 500, body: "" }) : route.continue(),
  );
const alert = (page: Page, text: string) => page.getByRole("alert").filter({ hasText: text });

test("the WhatsApp panel shows an error instead of freezing when the action fails", async ({ page }) => {
  await failActions(page);
  await page.goto(`/t/${slug}/whatsapp`);
  await expect(alert(page, "No pudimos hablar con WhatsApp")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
});

test("a failed stage change puts the select back and says so", async ({ page }) => {
  await page.goto(`/t/${slug}`);
  await page.waitForLoadState("networkidle");
  await failActions(page);
  const select = page.getByLabel("Etapa de Clara");
  await select.selectOption("venta");
  await expect(alert(page, "No pudimos cambiar la etapa")).toBeVisible();
  await expect(select).toHaveValue("consulta");
});

test("the tenant form keeps what was typed when validation fails", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Nombre del negocio").fill("Mi Negocio");
  await page.getByLabel("Identificador").fill("Mal Slug");
  await page.getByLabel("WhatsApp del administrador").fill("5491100000000");
  await page.getByRole("button", { name: "Crear negocio" }).click();
  await expect(page.getByText("Solo minúsculas, números y guiones")).toBeVisible();
  await expect(page.getByLabel("Nombre del negocio")).toHaveValue("Mi Negocio");
  await expect(page.getByLabel("Identificador")).toHaveValue("Mal Slug");
});
