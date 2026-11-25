import { describe, expect, it } from "vitest";
import { exampleKey } from "./examples";

describe("exampleKey", () => {
  it("normalizes case, accents, punctuation and emojis", () => {
    expect(exampleKey("¿A qué HORA abren?? 😊")).toBe("a que hora abren");
  });
  it("collapses lines and spaces", () => {
    expect(exampleKey("  hola\n\nchau  ")).toBe("hola chau");
  });
});
