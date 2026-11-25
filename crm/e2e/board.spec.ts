import { expect, test } from "@playwright/test";
import postgres from "postgres";

const sql = postgres(process.env.CRM_TEST_OWNER_URL ?? "", { max: 1, onnotice: () => {} });
const suffix = Math.random().toString(36).slice(2, 8);
const slug = `e2e-${suffix}`;
const emptySlug = `e2e-empty-${suffix}`;

test.beforeAll(async () => {
  const [t] = await sql<{ id: string }[]>`
    insert into tenants (slug, name, admin_phone) values (${slug}, 'Almacén E2E', '5491100000000') returning id`;
  await sql`insert into tenants (slug, name, admin_phone) values (${emptySlug}, 'Vacío E2E', '5491100000000')`;
  const [ana] = await sql<{ id: string }[]>`
    insert into contacts (tenant_id, jid, phone, name, last_message_at)
    values (${t.id}, '5491122334455@s.whatsapp.net', '5491122334455', 'Ana', now()) returning id`;
  await sql`insert into messages (tenant_id, contact_id, direction, author, body, wa_message_id, sent_at)
    values (${t.id}, ${ana.id}, 'in', 'customer', '¿Tienen pan de campo?', ${"m-" + suffix}, now())`;
  await sql`insert into contacts (tenant_id, jid, phone, name, last_message_at)
    values (${t.id}, '99887766@lid', null, 'Bruno', now() - interval '1 hour')`;
});

test.afterAll(async () => {
  await sql`delete from tenants where slug in (${slug}, ${emptySlug})`;
  await sql.end();
});

test("board shows three stages with counts", async ({ page }) => {
  await page.goto(`/t/${slug}`);
  await expect(page.getByRole("heading", { name: "Consulta 2", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Venta 0", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Postventa 0", exact: true })).toBeVisible();
});

test("a card with a phone opens the WhatsApp chat in a new tab", async ({ page }) => {
  await page.goto(`/t/${slug}`);
  const link = page.getByRole("link", { name: /Ana/ });
  await expect(link).toHaveAttribute("href", "https://wa.me/5491122334455");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toContainText("¿Tienen pan de campo?");
});

test("a card without a visible number is not a link", async ({ page }) => {
  await page.goto(`/t/${slug}`);
  await expect(page.getByRole("link", { name: /Bruno/ })).toHaveCount(0);
  await expect(page.getByRole("article").filter({ hasText: "Bruno" })).toContainText("Sin número visible");
});

test("Pasar a Venta moves a consulta card, which has no stage selector", async ({ page }) => {
  await page.goto(`/t/${slug}`);
  await expect(page.getByLabel("Etapa de Ana")).toHaveCount(0);
  await page.getByRole("button", { name: "Pasar a Venta: Ana" }).click();
  await expect(page.getByRole("region", { name: "Venta 1", exact: true }).getByText("Ana", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Venta 1", exact: true })).toBeVisible();
});

test("the card link and the stage control are reachable by keyboard", async ({ page }) => {
  await page.goto(`/t/${slug}`);
  await page.waitForLoadState("networkidle");
  const reached = new Set<string>();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    reached.add(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? ""));
  }
  expect([...reached].some((s) => s.includes("Ana"))).toBe(true);
  expect([...reached].some((s) => s === "Pasar a Venta: Bruno")).toBe(true);
});

test("an empty board invites to connect WhatsApp", async ({ page }) => {
  await page.goto(`/t/${emptySlug}`);
  await expect(page.getByText("Todavía no te escribió nadie")).toBeVisible();
  await expect(page.getByRole("link", { name: "Conectar WhatsApp" })).toHaveAttribute("href", `/t/${emptySlug}/whatsapp`);
});

test("the board says when no agent is configured and links to it", async ({ page }) => {
  await page.goto(`/t/${slug}`);
  const link = page.getByRole("link", { name: "Sin agente configurado" });
  await expect(link).toHaveAttribute("href", `/t/${slug}/configuracion/agente`);
});

test("a paused card says until when and can be reactivated", async ({ page }) => {
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = ${slug}`;
  await sql`insert into contacts (tenant_id, jid, phone, name, last_message_at, bot_paused_until)
    values (${t.id}, '5491122999000@s.whatsapp.net', '5491122999000', 'Carla', now(), now() + interval '2 hours')`;
  await page.goto(`/t/${slug}`);
  const card = page.getByRole("article").filter({ hasText: "Carla" });
  await expect(card).toContainText("Bot pausado hasta");
  await expect(card.getByRole("link").getByRole("button")).toHaveCount(0);
  await card.getByRole("button", { name: "Reactivar bot" }).click();
  await expect(card).not.toContainText("Bot pausado hasta");
});

test("Cerrar venta removes a postventa card", async ({ page }) => {
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = ${slug}`;
  const [dora] = await sql<{ id: string }[]>`insert into contacts (tenant_id, jid, phone, name, stage, last_message_at)
    values (${t.id}, '5491122999001@s.whatsapp.net', '5491122999001', 'Dora', 'postventa', now()) returning id`;
  await sql`insert into orders (tenant_id, contact_id, status, delivery_date, address, total, delivered_at)
    values (${t.id}, ${dora.id}, 'delivered', current_date, 'Calle 1', 100, now())`;
  await page.goto(`/t/${slug}`);
  const card = page.getByRole("article").filter({ hasText: "Dora" });
  await expect(page.getByRole("heading", { name: "Postventa 1", exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Cerrar venta" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Postventa 0", exact: true })).toBeVisible();
});

test("the × removes a consulta card", async ({ page }) => {
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = ${slug}`;
  await sql`insert into contacts (tenant_id, jid, phone, name, last_message_at)
    values (${t.id}, '5491122999002@s.whatsapp.net', '5491122999002', 'Elsa', now())`;
  await page.goto(`/t/${slug}`);
  const card = page.getByRole("article").filter({ hasText: "Elsa" });
  await card.getByRole("button", { name: "Quitar a Elsa del tablero" }).click();
  await expect(card).toHaveCount(0);
});

const tenantId = async () => (await sql<{ id: string }[]>`select id from tenants where slug = ${slug}`)[0].id;

test("a venta card goes back to consulta and has no stage selector", async ({ page }) => {
  await sql`insert into contacts (tenant_id, jid, phone, name, stage, last_message_at)
    values (${await tenantId()}, '5491122999003@s.whatsapp.net', '5491122999003', 'Fabio', 'venta', now())`;
  await page.goto(`/t/${slug}`);
  const card = page.getByRole("article").filter({ hasText: "Fabio" });
  await expect(card.getByLabel("Etapa de Fabio")).toHaveCount(0);
  await card.getByRole("button", { name: "Volver a Consulta: Fabio" }).click();
  await expect(page.getByRole("region", { name: /^Consulta/ }).getByText("Fabio", { exact: true })).toBeVisible();
});

test("the × of a venta card asks first, and refuses while an order is pending", async ({ page }) => {
  const t = await tenantId();
  const [gus] = await sql<{ id: string }[]>`insert into contacts (tenant_id, jid, phone, name, stage, last_message_at)
    values (${t}, '5491122999004@s.whatsapp.net', '5491122999004', 'Gus', 'venta', now()) returning id`;
  await sql`insert into contacts (tenant_id, jid, phone, name, stage, last_message_at)
    values (${t}, '5491122999005@s.whatsapp.net', '5491122999005', 'Hebe', 'venta', now())`;
  await sql`insert into orders (tenant_id, contact_id, delivery_date, address, total) values (${t}, ${gus.id}, '2099-12-01', 'X', 1)`;
  await page.goto(`/t/${slug}`);
  page.once("dialog", (d) => d.dismiss());
  const hebe = page.getByRole("article").filter({ hasText: "Hebe" });
  await hebe.getByRole("button", { name: "Quitar a Hebe del tablero" }).click();
  await expect(hebe).toHaveCount(1);
  page.once("dialog", (d) => d.accept());
  await hebe.getByRole("button", { name: "Quitar a Hebe del tablero" }).click();
  await expect(hebe).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  const gusCard = page.getByRole("article").filter({ hasText: "Gus" });
  await gusCard.getByRole("button", { name: "Quitar a Gus del tablero" }).click();
  await expect(gusCard.getByRole("alert")).toContainText("Entregá o cancelá el pedido antes de cerrar");
});

test("a postventa card keeps the stage selector and turns its bot off and on", async ({ page }) => {
  const t = await tenantId();
  const [ines] = await sql<{ id: string }[]>`insert into contacts (tenant_id, jid, phone, name, stage, last_message_at)
    values (${t}, '5491122999006@s.whatsapp.net', '5491122999006', 'Inés', 'postventa', now()) returning id`;
  await sql`insert into orders (tenant_id, contact_id, status, delivery_date, address, total, delivered_at)
    values (${t}, ${ines.id}, 'delivered', current_date, 'Calle 1', 100, now())`;
  await page.goto(`/t/${slug}`);
  const card = page.getByRole("article").filter({ hasText: "Inés" });
  await expect(card.getByLabel("Etapa de Inés")).toBeVisible();
  await card.getByRole("button", { name: "Desactivar bot: Inés" }).click();
  await expect(card).toContainText("Bot apagado");
  await card.getByRole("button", { name: "Activar bot: Inés" }).click();
  await expect(card).not.toContainText("Bot apagado");
});

test("a card that needs attention is red with its reason until the bot is reactivated", async ({ page }) => {
  await sql`insert into contacts (tenant_id, jid, phone, name, last_message_at, bot_off, attention_reason, attention_at)
    values (${await tenantId()}, '5491122999007@s.whatsapp.net', '5491122999007', 'Juana', now(), true, 'Pidió 300 de Kikuyo y no hay stock suficiente.', now())`;
  await page.goto(`/t/${slug}`);
  const card = page.getByRole("article").filter({ hasText: "Juana" });
  await expect(card).toHaveClass(/attention/);
  await expect(card).toContainText("Necesita atención: Pidió 300 de Kikuyo y no hay stock suficiente.");
  await card.getByRole("button", { name: "Reactivar bot" }).click();
  await expect(card).not.toHaveClass(/attention/);
  await expect(card).not.toContainText("Necesita atención");
});
