import { expect, test } from "@playwright/test";
import postgres from "postgres";

const sql = postgres(process.env.CRM_TEST_OWNER_URL ?? "", { max: 1, onnotice: () => {} });
const suffix = Math.random().toString(36).slice(2, 8);
const slug = `e2e-facts-${suffix}`;
const emptySlug = `e2e-facts-empty-${suffix}`;

test.beforeAll(async () => {
  const [t] = await sql<{ id: string }[]>`insert into tenants (slug, name, admin_phone) values (${slug}, 'Aprendido E2E', '5491100000000') returning id`;
  await sql`insert into tenants (slug, name, admin_phone) values (${emptySlug}, 'Vacío E2E', '5491100000000')`;
  const [c] = await sql<{ id: string }[]>`insert into contacts (tenant_id, jid, name) values (${t.id}, '5491122000099@s.whatsapp.net', 'Ana') returning id`;
  await sql`insert into escalations (tenant_id, contact_id, question, is_price, admin_message_id) values (${t.id}, ${c.id}, '¿Abren el domingo?', false, ${"E2E-" + suffix})`;
  await sql`insert into business_facts (tenant_id, question, answer) values (${t.id}, '¿Hacen envíos a Pilar?', 'Sí, los martes')`;
  await sql`insert into router_examples (tenant_id, key, text, fn) values (${t.id}, 'che cuando estan abiertos', 'Che, ¿cuándo están abiertos?', 'hours')`;
});
test.afterAll(async () => {
  await sql`delete from tenants where slug in (${slug}, ${emptySlug})`;
  await sql.end();
});

test("shows pending questions and lets you edit and delete learned answers", async ({ page }) => {
  await page.goto(`/t/${slug}/aprendido`);
  await expect(page.getByText("¿Abren el domingo?")).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "¿Hacen envíos a Pilar?" }).getByRole("button", { name: "Editar" }).click();
  // While editing, the texts live inside the inputs: address the (only) form directly.
  await page.getByLabel("Respuesta").fill("Sí, martes y jueves");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Sí, martes y jueves")).toBeVisible();
  const item = page.getByRole("listitem").filter({ hasText: "Sí, martes y jueves" });
  await item.getByRole("button", { name: "Borrar" }).click();
  await item.getByRole("button", { name: "Confirmar borrado" }).click();
  await expect(page.getByText("¿Hacen envíos a Pilar?")).toHaveCount(0);
});

test("a pending question can be dismissed", async ({ page }) => {
  await page.goto(`/t/${slug}/aprendido`);
  const item = page.getByRole("listitem").filter({ hasText: "¿Abren el domingo?" });
  await item.getByRole("button", { name: "Descartar" }).click();
  await expect(page.getByText("¿Abren el domingo?")).toHaveCount(0);
});

test("explains what this screen is for when nothing was learned yet", async ({ page }) => {
  await page.goto(`/t/${emptySlug}/aprendido`);
  await expect(page.getByText(/Todavía no aprendió nada/)).toBeVisible();
  await expect(page.getByText("Todavía no hay atajos: aparecen cuando el bot detecta preguntas frecuentes.")).toBeVisible();
});

test("lists the bot's shortcuts with their function and lets you delete one", async ({ page }) => {
  await page.goto(`/t/${slug}/aprendido`);
  const section = page.getByRole("region", { name: /Atajos del bot/ });
  const item = section.getByRole("listitem").filter({ hasText: "Che, ¿cuándo están abiertos?" });
  await expect(item).toContainText("Horarios");
  await item.getByRole("button", { name: "Borrar atajo: Che, ¿cuándo están abiertos?" }).click();
  await expect(page.getByText("Che, ¿cuándo están abiertos?")).toHaveCount(0);
});
