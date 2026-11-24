import { expect, test } from "@playwright/test";
import postgres from "postgres";

const sql = postgres(process.env.CRM_TEST_OWNER_URL ?? "", { max: 1, onnotice: () => {} });
const slug = `e2e-biz-${Math.random().toString(36).slice(2, 8)}`;

test.beforeAll(async () => {
  await sql`insert into tenants (slug, name, admin_phone) values (${slug}, 'Negocio E2E', '5491100000000')`;
});
test.afterAll(async () => {
  await sql`delete from tenants where slug = ${slug}`;
  await sql.end();
});

test("Configuración opens on Agente and shows the three sub-tabs", async ({ page }) => {
  await page.goto(`/t/${slug}/configuracion`);
  await expect(page).toHaveURL(new RegExp(`/t/${slug}/configuracion/agente$`));
  const nav = page.getByRole("navigation", { name: "Secciones de configuración" });
  await expect(nav.getByRole("link", { name: "Agente" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Tablero" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Negocio" })).toBeVisible();
});

test("old /agente link redirects", async ({ page }) => {
  await page.goto(`/t/${slug}/agente`);
  await expect(page).toHaveURL(new RegExp(`/t/${slug}/configuracion/agente$`));
});

test("saves business info", async ({ page }) => {
  await page.goto(`/t/${slug}/configuracion/negocio`);
  await page.getByLabel("Horarios").fill("Lun a vie 9 a 18");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("status")).toHaveText("Información guardada.");
  await page.reload();
  await expect(page.getByLabel("Horarios")).toHaveValue("Lun a vie 9 a 18");
});

test("shows field error", async ({ page }) => {
  await page.goto(`/t/${slug}/configuracion/negocio`);
  await page.getByLabel("Horarios").fill("x".repeat(1001));
  await page.getByRole("button", { name: "Guardar" }).click();
  const field = page.getByLabel("Horarios");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#hours-hint.error")).toBeVisible();
});
