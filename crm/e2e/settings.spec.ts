import { expect, test } from "@playwright/test";
import postgres from "postgres";

const sql = postgres(process.env.CRM_TEST_OWNER_URL ?? "", { max: 1, onnotice: () => {} });
const slug = `e2e-cfg-${Math.random().toString(36).slice(2, 8)}`;

test.beforeAll(async () => {
  await sql`insert into tenants (slug, name, admin_phone) values (${slug}, 'Ajustes E2E', '5491100000000')`;
});
test.afterAll(async () => {
  await sql`delete from tenants where slug = ${slug}`;
  await sql.end();
});

test("Configuración saves the idle days", async ({ page }) => {
  await page.goto(`/t/${slug}`);
  await page.getByRole("navigation", { name: "Secciones del negocio" }).getByRole("link", { name: "Configuración" }).click();
  await page.getByRole("navigation", { name: "Secciones de configuración" }).getByRole("link", { name: "Tablero" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tablero" })).toBeVisible();
  const field = page.getByLabel("Quitar consultas sin actividad después de N días");
  await expect(field).toHaveValue("1");
  await field.fill("3");
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(page.getByRole("status")).toHaveText("Configuración guardada.");
  await page.reload();
  await expect(page.getByLabel("Quitar consultas sin actividad después de N días")).toHaveValue("3");
});

test("Configuración explains an out-of-range value", async ({ page }) => {
  await page.goto(`/t/${slug}/configuracion/tablero`);
  await page.getByLabel("Quitar consultas sin actividad después de N días").fill("45");
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(page.getByText("Entre 1 y 30 días")).toBeVisible();
});
