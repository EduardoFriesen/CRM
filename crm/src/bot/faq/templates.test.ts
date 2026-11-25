import { describe, expect, it } from "vitest";
import { fill, TEMPLATES, type TemplateKey } from "./templates";

const keys = Object.keys(TEMPLATES) as TemplateKey[];

describe("templates", () => {
  it("every key has 2 or 3 variants", () => {
    for (const k of keys) expect(TEMPLATES[k].length, k).toBeGreaterThanOrEqual(2);
    for (const k of keys) expect(TEMPLATES[k].length, k).toBeLessThanOrEqual(3);
  });

  it("fill replaces all variables", () => {
    const out = fill("hours", { hours: "Lun a vie 9 a 18" });
    expect(out).toContain("Lun a vie 9 a 18");
    expect(out).not.toContain("{");
  });

  it("fill throws when a variable is missing", () => {
    expect(() => fill("hours", {})).toThrow();
  });

  it("pick picks the variant", () => {
    const vars = { hours: "9 a 18" };
    expect(fill("hours", vars, () => 0)).not.toBe(fill("hours", vars, () => 0.99));
  });

  it("no template asks for or gives stock numbers", () => {
    for (const k of keys.filter((k) => k === "stock" || k.startsWith("price_"))) {
      for (const v of TEMPLATES[k]) {
        expect(v).not.toContain("{stock}");
        expect(v).not.toContain("unidades");
      }
    }
  });
});
