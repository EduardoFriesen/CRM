import { MockLanguageModelV4 } from "ai/test";
import { afterAll, describe, expect, it, vi } from "vitest";
import { saveAgentConfig } from "@/agent/config";
import { createModel } from "@/agent/model";
import { runConversation } from "@/bot/reply";
import { dropTenants, makeContact, makeInstance, makeTenant, ownerSql } from "@/test/db";

// Production wiring: with no models injected, the router is built from the tenant's settings.
vi.mock("@/agent/model", async (orig) => ({
  ...(await orig<typeof import("@/agent/model")>()),
  createModel: vi.fn(async () => new MockLanguageModelV4({ doGenerate: async () => { throw new Error("unused"); } })),
}));

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

async function setup(routerModel: string) {
  const t = await makeTenant();
  await makeInstance(t.id, t.slug, "h");
  await saveAgentConfig(t.id, { agentName: "Sofi", provider: "anthropic", model: "main-m", routerModel, apiKey: "sk-test-1234", enabled: "on" }, async () => "valid");
  const c = await makeContact(t.id, { name: "Ana", phone: "5491122334455", jid: `549${Date.now() % 1e10}@s.whatsapp.net` });
  await ownerSql`insert into messages (tenant_id, contact_id, direction, author, body, wa_message_id, sent_at)
    values (${t.id}, ${c.id}, 'in', 'customer', 'me contas como es el tema de los pedidos grandes', ${"seed-" + Math.random()}, now())`;
  return { t, c };
}

describe("runConversation router model", () => {
  it("builds the router from the tenant's router model, or the main model when blank", async () => {
    for (const [routerModel, expected] of [["router-m", "router-m"], ["", "main-m"]]) {
      vi.mocked(createModel).mockClear();
      const { t, c } = await setup(routerModel);
      await runConversation(t.id, c.id, { send: async () => ({ id: `BOT-${Math.random()}` }) }).catch(() => {});
      expect(vi.mocked(createModel).mock.calls[0]?.[0]).toMatchObject({ model: expected });
    }
  });
});
