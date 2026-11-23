import { afterAll, describe, expect, it, vi } from "vitest";
import { notifyAdmin } from "@/bot/admin-messages";
import { dropTenants, makeInstance, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

describe("notifyAdmin", () => {
  it("sends through the tenant's instance to the admin's WhatsApp", async () => {
    const t = await makeTenant();
    await makeInstance(t.id, t.slug, "h");
    const send = vi.fn(async () => ({ id: "ADM1" }));
    expect(await notifyAdmin(t.id, "hola", { send })).toEqual({ id: "ADM1" });
    expect(send).toHaveBeenCalledWith(t.slug, "5491100000000@s.whatsapp.net", "hola");
  });
});
