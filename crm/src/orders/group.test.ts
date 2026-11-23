import { describe, expect, it } from "vitest";
import { groupOrders } from "@/orders/group";

const order = (deliveryDate: string) => ({ deliveryDate }) as Parameters<typeof groupOrders>[0][number];

describe("groupOrders", () => {
  it("buckets pending orders by delivery day in Buenos Aires", () => {
    const now = new Date("2026-11-24T15:00:00Z");
    const g = groupOrders([order("2026-11-23"), order("2026-11-24"), order("2026-11-25"), order("2026-11-28")], now);
    expect([g.overdue, g.today, g.tomorrow, g.upcoming].map((x) => x.map((o) => o.deliveryDate))).toEqual([
      ["2026-11-23"],
      ["2026-11-24"],
      ["2026-11-25"],
      ["2026-11-28"],
    ]);
  });

  it("uses the Buenos Aires date late at night (UTC already next day)", () => {
    const now = new Date("2026-11-25T01:30:00Z"); // 22:30 on the 24th in Buenos Aires
    expect(groupOrders([order("2026-11-24")], now).today).toHaveLength(1);
  });
});
