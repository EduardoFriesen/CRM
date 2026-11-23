import { describe, expect, it } from "vitest";
import { isIgnoredJid, phoneFromJid } from "@/whatsapp/jid";

describe("phoneFromJid", () => {
  it("extracts digits from a phone JID", () => {
    expect(phoneFromJid("5491122334455@s.whatsapp.net")).toBe("5491122334455");
  });
  it("returns null for a LID without an alternative", () => {
    expect(phoneFromJid("123456789@lid")).toBeNull();
  });
  it("uses the phone alternative of a LID", () => {
    expect(phoneFromJid("123456789@lid", "5491122334455@s.whatsapp.net")).toBe("5491122334455");
  });
  it("ignores a non-phone alternative", () => {
    expect(phoneFromJid("123@lid", "456@lid")).toBeNull();
  });
});

describe("isIgnoredJid", () => {
  it.each(["120363@g.us", "status@broadcast", "1203@newsletter"])("ignores %s", (jid) => {
    expect(isIgnoredJid(jid)).toBe(true);
  });
  it.each(["5491122334455@s.whatsapp.net", "123@lid"])("keeps %s", (jid) => {
    expect(isIgnoredJid(jid)).toBe(false);
  });
});
