import { describe, expect, it } from "vitest";
import { parseCliArgs, summarize, type EventRow } from "./metrics-report";

const row = (o: Partial<EventRow>): EventRow => ({
  path: "complex",
  model: "m",
  router_model: null,
  input_tokens: 0,
  output_tokens: 0,
  cached_tokens: 0,
  router_input_tokens: 0,
  router_output_tokens: 0,
  ...o,
});
const prices = { m: { input: 1, output: 2, cached: 0.5 }, r: { input: 0.1, output: 0.2, cached: 0 } };

describe("summarize", () => {
  it("shares add up to 100", () => {
    const rep = summarize([row({ path: "faq" }), row({ path: "complex" }), row({ path: "silence" })], prices);
    const sum = Object.values(rep.byPath).reduce((a, p) => a + p.share, 0);
    expect(sum).toBeCloseTo(100);
    expect(rep.total).toBe(3);
  });

  it("averages per path", () => {
    const rep = summarize(
      [row({ input_tokens: 100, output_tokens: 10, cached_tokens: 20 }), row({ input_tokens: 300, output_tokens: 30, cached_tokens: 0 })],
      prices,
    );
    expect(rep.byPath.complex).toMatchObject({ avgInput: 200, avgOutput: 20, avgCached: 10 });
  });

  it("cost uses cached price for cached tokens", () => {
    const rep = summarize([row({ input_tokens: 1_000_000, cached_tokens: 400_000, output_tokens: 1_000_000 })], prices);
    // 600k * 1 + 400k * 0.5 + 1M * 2 = 2.8
    expect(rep.byPath.complex.costUsd).toBeCloseTo(2.8);
  });

  it("prices router tokens with the router model", () => {
    const rep = summarize(
      [row({ path: "faq", model: null, router_model: "r", router_input_tokens: 1_000_000, router_output_tokens: 1_000_000 })],
      prices,
    );
    expect(rep.byPath.faq.costUsd).toBeCloseTo(0.3);
  });

  it("lists models missing from prices and excludes their cost", () => {
    const rep = summarize([row({ model: "x", input_tokens: 1_000_000 }), row({ router_model: "y", router_input_tokens: 5 })], prices);
    expect(rep.unknownModels).toEqual(["x", "y"]);
    expect(rep.byPath.complex.costUsd).toBeCloseTo(0);
  });

  it("returns an empty report for no rows", () => {
    const rep = summarize([], prices);
    expect(rep.total).toBe(0);
    expect(rep.byPath.faq).toMatchObject({ share: 0, avgInput: 0, costUsd: 0 });
  });
});

describe("parseCliArgs", () => {
  it("defaults to 7 days", () => {
    expect(parseCliArgs([])).toEqual({ days: 7, tenant: undefined });
  });
  it("parses days and tenant", () => {
    expect(parseCliArgs(["--days", "3", "--tenant", "acme"])).toEqual({ days: 3, tenant: "acme" });
  });
  it.each([["0.5"], ["0"], ["-1"], ["abc"]])("rejects --days %s", (d) => {
    expect(() => parseCliArgs(["--days", d])).toThrow();
  });
  it("rejects unknown flags and a missing value", () => {
    expect(() => parseCliArgs(["--foo"])).toThrow();
    expect(() => parseCliArgs(["--tenant"])).toThrow();
  });
});
