import { describe, expect, it } from "vitest";
import { relativeTime } from "@/lib/time";

const now = new Date("2026-11-23T12:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000);

describe("relativeTime", () => {
  it("says 'recién' under a minute", () => expect(relativeTime(ago(20), now)).toBe("recién"));
  it("uses minutes", () => expect(relativeTime(ago(5 * 60), now)).toBe("hace 5 minutos"));
  it("uses hours", () => expect(relativeTime(ago(3 * 3600), now)).toBe("hace 3 horas"));
  it("uses days", () => expect(relativeTime(ago(2 * 86400), now)).toBe("anteayer"));
  it("handles no date", () => expect(relativeTime(null, now)).toBe("sin mensajes"));
});
