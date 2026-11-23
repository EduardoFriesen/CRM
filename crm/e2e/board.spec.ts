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
  await sql`insert into messages (tenant_id, contact_id, direction, body, wa_message_id, sent_at)
    values (${t.id}, ${ana.id}, 'in', '¿Tienen pan de campo?', ${"m-" + suffix}, now())`;
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

test("changing the stage moves the card", async ({ page }) => {
  await page.goto(`/t/${slug}`);
  await page.getByLabel("Etapa de Ana").selectOption("venta");
  await expect(page.getByRole("region", { name: "Venta 1", exact: true }).getByText("Ana")).toBeVisible();
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
  expect([...reached].some((s) => s === "Etapa de Bruno")).toBe(true);
});

test("an empty board invites to connect WhatsApp", async ({ page }) => {
  await page.goto(`/t/${emptySlug}`);
  await expect(page.getByText("Todavía no te escribió nadie")).toBeVisible();
  await expect(page.getByRole("link", { name: "Conectar WhatsApp" })).toHaveAttribute("href", `/t/${emptySlug}/whatsapp`);
});
