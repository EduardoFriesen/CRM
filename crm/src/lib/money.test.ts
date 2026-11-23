import { describe, expect, it } from "vitest";
import { formatPrice } from "@/lib/money";

describe("formatPrice", () => {
  it("drops decimals on round prices", () => expect(formatPrice("2500.00")).toBe("$2.500"));
  it("keeps two decimals otherwise", () => expect(formatPrice(2500.5)).toBe("$2.500,50"));
  it("formats zero", () => expect(formatPrice(0)).toBe("$0"));
});
