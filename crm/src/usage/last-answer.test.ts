import { describe, expect, it } from "vitest";
import { describeAnswerer } from "./last-answer";

const e = (path: string, routerModel: string | null, model: string | null) =>
  ({ path, routerModel, model }) as Parameters<typeof describeAnswerer>[0];

describe("describeAnswerer", () => {
  it("names the router model for an FAQ answer", () => {
    expect(describeAnswerer(e("faq", "haiku", null))).toBe("Router (haiku)");
  });
  it("names the main model for a complex answer, even when the router passed first", () => {
    expect(describeAnswerer(e("complex", "haiku", "sonnet"))).toBe("Pesado (sonnet)");
  });
  it("names the main model for a relay", () => {
    expect(describeAnswerer(e("relay", null, "sonnet"))).toBe("Pesado (sonnet)");
  });
  it("says a rule answered without AI", () => {
    expect(describeAnswerer(e("prefilter", null, null))).toBe("Regla (sin IA)");
    expect(describeAnswerer(e("handoff", null, null))).toBe("Regla (sin IA)");
  });
  it("credits the router for a handoff it decided", () => {
    expect(describeAnswerer(e("handoff", "haiku", null))).toBe("Router (haiku)");
  });
  it("shows a dash when there is no answer yet", () => {
    expect(describeAnswerer(null)).toBe("—");
  });
});
