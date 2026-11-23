import { expect, test } from "@playwright/test";
import postgres from "postgres";

// The E2E server runs without OLLAMA_URL: like a server that dropped the dev override.
const sql = postgres(process.env.CRM_TEST_OWNER_URL ?? "", { max: 1, onnotice: () => {} });
const slug = `e2e-ollama-${Math.random().toString(36).slice(2, 8)}`;

test.beforeAll(async () => {
  const [t] = await sql<{ id: string }[]>`insert into tenants (slug, name, admin_phone) values (${slug}, 'Ollama E2E', '5491100000000') returning id`;
  await sql`insert into agent_configs (tenant_id, agent_name, provider, model, api_key_enc, api_key_last4)
    values (${t.id}, 'Sofi', 'ollama', 'qwen3:8b', 'x', '')`;
});
test.afterAll(async () => {
  await sql`delete from tenants where slug = ${slug}`;
  await sql.end();
});

test("an Ollama agent on a server without Ollama asks for a real provider and key", async ({ page }) => {
  await page.goto(`/t/${slug}/agente`);
  await expect(page.getByLabel("Proveedor")).toHaveValue("anthropic");
  await expect(page.getByText("Sin API key: usa el Ollama de esta máquina.")).toHaveCount(0);
  const key = page.getByLabel("API key");
  await expect(key).toBeVisible();
  await expect(key).not.toHaveAttribute("placeholder", "Dejala vacía para conservar la actual");
});
