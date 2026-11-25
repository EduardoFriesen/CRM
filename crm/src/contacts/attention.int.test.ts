import { afterAll, describe, expect, it, vi } from "vitest";
import { listBoard, setBotOff } from "@/contacts/contacts";
import { requestAttention } from "@/bot/tools";
import { dropTenants, makeContact, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const row = async (id: string) =>
  (await ownerSql`select stage, bot_off, bot_paused_until, attention_reason, attention_at from contacts where id = ${id}`)[0];

describe("attention", () => {
  it("keeps the stage, turns the bot off, records the reason and tells the admin", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id, { name: "Ana", phone: "5491122334455" });
    await ownerSql`update contacts set stage = 'postventa' where id = ${c.id}`;
    const notify = vi.fn(async () => ({ id: "m1" }));
    await requestAttention(t.id, c.id, "El pedido llegó roto.", { notify });
    const r = await row(c.id);
    expect(r).toMatchObject({ stage: "postventa", bot_off: true, attention_reason: "El pedido llegó roto." });
    expect(r.attention_at).not.toBeNull();
    expect(notify).toHaveBeenCalledWith("⚠️ Ana (+5491122334455) necesita atención: El pedido llegó roto. Atendelo desde el WhatsApp del negocio.");
  });

  it("turning the bot back on clears the attention, the off flag and the pause", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    await ownerSql`update contacts set bot_off = true, attention_reason = 'x', attention_at = now(), bot_paused_until = now() + interval '1 hour' where id = ${c.id}`;
    expect(await setBotOff(t.id, c.id, false)).toEqual({ success: true, data: { id: c.id } });
    expect(await row(c.id)).toMatchObject({ bot_off: false, bot_paused_until: null, attention_reason: null, attention_at: null });
  });

  it("turning the bot off sets only the flag, and other tenants cannot", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const c = await makeContact(a.id);
    expect(await setBotOff(b.id, c.id, true)).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    expect(await setBotOff(a.id, "nope", true)).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    await setBotOff(a.id, c.id, true);
    expect(await row(c.id)).toMatchObject({ bot_off: true, attention_reason: null });
  });

  it("the board shows the off flag, the attention reason and the nearest pending order", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    await ownerSql`update contacts set stage = 'venta', bot_off = true, attention_reason = 'reclamo', last_message_at = now() where id = ${c.id}`;
    const [late] = await ownerSql<{ id: string }[]>`insert into orders (tenant_id, contact_id, delivery_date, address, total) values
      (${t.id}, ${c.id}, '2099-12-10', 'X', 1), (${t.id}, ${c.id}, '2099-12-01', 'X', 1) returning id`.then((r) => [r[1]]);
    const board = await listBoard(t.id);
    expect(board.venta[0]).toMatchObject({ botOff: true, attentionReason: "reclamo", pendingOrderId: late.id });
  });
});
