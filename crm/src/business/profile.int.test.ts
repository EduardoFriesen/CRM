import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { saveAgentConfig } from "@/agent/config";
import { getBusinessProfile, saveBusinessProfile } from "@/business/profile";
import { dropTenants, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

describe("business profile", () => {
  it("returns empty fields when nothing is saved", async () => {
    const t = await makeTenant();
    expect(await getBusinessProfile(t.id)).toEqual({ hours: "", address: "", paymentMethods: "", shipping: "", other: "" });
  });

  it("saves and trims", async () => {
    const t = await makeTenant();
    const res = await saveBusinessProfile(t.id, { hours: "  Lun a vie 9 a 18  " });
    expect(res.success).toBe(true);
    expect((await getBusinessProfile(t.id)).hours).toBe("Lun a vie 9 a 18");
  });

  it("rejects a field over 1000 chars", async () => {
    const t = await makeTenant();
    const res = await saveBusinessProfile(t.id, { hours: "x".repeat(1001) });
    expect(res.success).toBe(false);
    if (!res.success) expect((res.error.details as Record<string, unknown>).hours).toBeDefined();
  });

  it("is private to each tenant", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await saveBusinessProfile(b.id, { address: "Calle 1" });
    expect((await getBusinessProfile(a.id)).address).toBe("");
  });

  it("migration copies business_info into other, skipping empty ones", async () => {
    const seed = async (info: string) => {
      const t = await makeTenant();
      await saveAgentConfig(t.id, { agentName: "Sofi", provider: "anthropic", model: "m", apiKey: "sk-test-1234" }, async () => "valid");
      await ownerSql`update agent_configs set business_info = ${info} where tenant_id = ${t.id}`;
      await ownerSql`delete from business_profiles where tenant_id = ${t.id}`;
      return t.id;
    };
    const full = await seed("Envíos a todo el país");
    const empty = await seed("");
    const sqlText = readFileSync("drizzle/0021_business_profiles.sql", "utf8");
    const copy = sqlText.split("--> statement-breakpoint").find((s) => s.includes('INSERT INTO "business_profiles"'));
    expect(copy).toBeDefined();
    await ownerSql.unsafe(copy!);
    const rows = await ownerSql<{ tenant_id: string; other: string }[]>`
      select tenant_id, other from business_profiles where tenant_id = any(${[full, empty]})`;
    expect(rows.find((r) => r.tenant_id === full)?.other).toBe("Envíos a todo el país");
    expect(rows.find((r) => r.tenant_id === empty)).toBeUndefined();
  });
});
