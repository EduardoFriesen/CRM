import { describe, expect, it } from "vitest";
import { plain } from "./plain";

describe("plain", () => {
  it("strips accents and lowercases", () => {
    expect(plain("Ñandú DÓNDE")).toBe("nandu donde");
  });
});
