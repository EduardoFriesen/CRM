import { describe, expect, it } from "vitest";
import { waLink } from "@/contacts/wa-link";

describe("waLink", () => {
  it("builds a wa.me link from digits", () => {
    expect(waLink("5491122334455")).toBe("https://wa.me/5491122334455");
  });
  it("returns null without a phone", () => {
    expect(waLink(null)).toBeNull();
  });
});
