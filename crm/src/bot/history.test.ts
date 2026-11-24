import { describe, expect, it } from "vitest";
import { toModelMessages } from "./history";

describe("toModelMessages", () => {
  it("drops leading assistant turns so the history opens with the user", () => {
    expect(
      toModelMessages(
        [
          { role: "assistant", text: "¡Hola!" },
          { role: "user", text: "quiero pan" },
        ],
        { toolCalls: true },
      ),
    ).toEqual([{ role: "user", content: "quiero pan" }]);
  });

  it("expands a handoff turn into tool-call, tool-result and the text", () => {
    const messages = toModelMessages(
      [
        { role: "user", text: "quiero 2" },
        { role: "assistant", text: "Te atiende alguien del equipo.", handoff: true },
        { role: "user", text: "quiero 2 más" },
        { role: "assistant", text: "Ya te atiende alguien.", handoff: true },
        { role: "user", text: "dale" },
      ],
      { toolCalls: true },
    );
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "user", "assistant", "tool", "assistant", "user"]);
    expect(messages[1]).toMatchObject({ content: [{ type: "tool-call", toolName: "handoff_to_admin" }] });
    expect(messages[2]).toMatchObject({
      content: [{ type: "tool-result", toolName: "handoff_to_admin", output: { type: "json", value: { ok: true } } }],
    });
    expect(messages[3]).toEqual({ role: "assistant", content: "Te atiende alguien del equipo." });
    const ids = [messages[1], messages[5]].map((m) => (m.content as { toolCallId: string }[])[0].toolCallId);
    expect(new Set(ids).size).toBe(2);
    expect((messages[2].content as { toolCallId: string }[])[0].toolCallId).toBe(ids[0]);
  });

  it("keeps a handoff turn as plain text when toolCalls is false", () => {
    expect(
      toModelMessages(
        [
          { role: "user", text: "quiero 2" },
          { role: "assistant", text: "Te atiende alguien del equipo.", handoff: true },
        ],
        { toolCalls: false },
      ),
    ).toEqual([
      { role: "user", content: "quiero 2" },
      { role: "assistant", content: "Te atiende alguien del equipo." },
    ]);
  });
});
