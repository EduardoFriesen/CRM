import { expect, test } from "@playwright/test";
import postgres from "postgres";

const sql = postgres(process.env.CRM_TEST_OWNER_URL ?? "", { max: 1, onnotice: () => {} });
const slug = `e2e-cat-${Math.random().toString(36).slice(2, 8)}`;

test.beforeAll(async () => {
  await sql`insert into tenants (slug, name, admin_phone) values (${slug}, 'Catálogo E2E', '5491100000000')`;
});
test.afterAll(async () => {
  await sql`delete from tenants where slug = ${slug}`;
  await sql.end();
});

test("manage the catalog end to end", async ({ page }) => {
  await page.goto(`/t/${slug}/catalogo`);
  await expect(page.getByText("Todavía no cargaste productos")).toBeVisible();

  await page.getByLabel("Nombre").fill("Pan de campo");
  await page.getByLabel("Precio").fill("-1");
  await page.getByLabel("Stock").fill("12");
  await page.getByRole("button", { name: "Agregar producto" }).click();
  await expect(page.getByText(/mayor o igual a 0/)).toBeVisible();
  await expect(page.getByLabel("Nombre")).toHaveValue("Pan de campo");

  await page.getByLabel("Precio").fill("2500");
  await page.getByRole("button", { name: "Agregar producto" }).click();
  const row = page.getByRole("row", { name: /Pan de campo/ });
  await expect(row).toContainText("$2.500");
  await expect(row).toContainText("12");

  await row.getByRole("button", { name: "Pausar" }).click();
  await expect(row).toContainText("Pausado");

  await row.getByRole("button", { name: "Borrar" }).click();
  await row.getByRole("button", { name: "Confirmar borrado" }).click();
  await expect(page.getByRole("row", { name: /Pan de campo/ })).toHaveCount(0);
});
