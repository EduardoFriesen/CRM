import type { ModelMessage } from "ai";

export type HistoryTurn = { role: "user" | "assistant"; text: string; handoff?: boolean };

// Builds the model's history. Providers expect it to open with the user, so leading bot or
// admin turns are dropped. A past handoff goes back as a real handoff_to_admin call: replayed
// as bare text, models copy the sentence and skip the tool, so the next handoff never
// happens (qwen3:8b: 0/8 with text only, 8/8 with the call). Callers without tools (the
// relay) pass toolCalls: false.
export function toModelMessages(turns: HistoryTurn[], opts: { toolCalls: boolean }): ModelMessage[] {
  const first = turns.findIndex((t) => t.role === "user");
  if (first < 0) return [];
  return turns.slice(first).flatMap((t, i): ModelMessage[] => {
    if (t.role === "user") return [{ role: "user", content: t.text }];
    const reply: ModelMessage = { role: "assistant", content: t.text };
    if (!t.handoff || !opts.toolCalls) return [reply];
    const toolCallId = `handoff-${i}`;
    const toolName = "handoff_to_admin";
    return [
      { role: "assistant", content: [{ type: "tool-call", toolCallId, toolName, input: { reason: "el cliente quiere cerrar la compra" } }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId, toolName, output: { type: "json", value: { ok: true } } }] },
      reply,
    ];
  });
}
