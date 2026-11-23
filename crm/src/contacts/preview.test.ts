import { describe, expect, it } from "vitest";
import { messagePreview } from "@/contacts/preview";

describe("messagePreview", () => {
  it("keeps text as is", () => expect(messagePreview("Hola")).toEqual({ text: "Hola", media: false }));
  it("names known media", () => expect(messagePreview("[audioMessage]")).toEqual({ text: "Audio", media: true }));
  it("names unknown non-text messages generically", () =>
    expect(messagePreview("[pollCreationMessage]")).toEqual({ text: "Mensaje sin texto", media: true }));
  it("does not treat bracketed prose as media", () =>
    expect(messagePreview("[urgente] mañana")).toEqual({ text: "[urgente] mañana", media: false }));
});
