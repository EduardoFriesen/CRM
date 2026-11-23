import { describe, expect, it } from "vitest";
import { shouldAutoRefresh } from "./refresh-guard";

const doc = (visibility: string, openDialog: boolean) =>
  ({ visibilityState: visibility, querySelector: (s: string) => (s === "dialog[open]" && openDialog ? {} : null) }) as unknown as Document;

describe("shouldAutoRefresh", () => {
  it("refreshes a visible page", () => expect(shouldAutoRefresh(doc("visible", false))).toBe(true));
  it("skips hidden tabs", () => expect(shouldAutoRefresh(doc("hidden", false))).toBe(false));
  it("never refreshes under an open dialog (it could unmount a form being filled)", () =>
    expect(shouldAutoRefresh(doc("visible", true))).toBe(false));
});
