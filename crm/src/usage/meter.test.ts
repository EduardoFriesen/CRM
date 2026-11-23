import { describe, expect, it } from "vitest";
import { usageMeter } from "@/usage/meter";

const u = (requests: number, tokens = 0) => ({ requests, inputTokens: tokens, outputTokens: 0 });

describe("usageMeter", () => {
  it("shows nothing to compare against without limits", () => {
    expect(usageMeter(u(50), { requests: null, tokens: null })).toEqual({ percent: null, level: null, label: null });
  });
  it("warns from 80%", () => {
    expect(usageMeter(u(800), { requests: 1000, tokens: null })).toEqual({ percent: 80, level: "warn", label: "800 de 1.000 pedidos" });
  });
  it("is full at 100% and caps the bar there", () => {
    expect(usageMeter(u(1000), { requests: 1000, tokens: null })).toMatchObject({ percent: 100, level: "full" });
    expect(usageMeter(u(1200), { requests: 1000, tokens: null })).toMatchObject({ percent: 100, level: "full", label: "1.200 de 1.000 pedidos" });
  });
  it("uses the limit closest to running out", () => {
    expect(usageMeter(u(10, 190_000), { requests: 1000, tokens: 200_000 })).toEqual({
      percent: 95,
      level: "warn",
      label: "190.000 de 200.000 tokens",
    });
  });
  it("is ok below 80%", () => expect(usageMeter(u(10), { requests: 1000, tokens: null }).level).toBe("ok"));
});
