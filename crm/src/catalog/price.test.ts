import { describe, expect, it } from "vitest";
import { productInput } from "@/catalog/catalog";

const price = (raw: string) => productInput.parse({ name: "x", price: raw }).price;

describe("product price input", () => {
  it.each([
    ["2500", 2500],
    ["2.500", 2500],
    ["1.234.567", 1234567],
    ["2.500,50", 2500.5],
    ["2500,50", 2500.5],
    ["2500.50", 2500.5],
    ["12.5", 12.5],
    [" 4.800 ", 4800],
  ])("reads %s as %d", (raw, expected) => expect(price(raw)).toBe(expected));

  it("rejects ambiguous mixes", () => {
    expect(productInput.safeParse({ name: "x", price: "2,500.50" }).success).toBe(false);
  });
});
