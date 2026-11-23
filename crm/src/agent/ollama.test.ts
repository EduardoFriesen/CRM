import { generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { availableProviders, createModel } from "@/agent/model";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ollama provider", () => {
  it("only exists when the server sets OLLAMA_URL", () => {
    vi.stubEnv("OLLAMA_URL", "");
    expect(availableProviders()).not.toContain("ollama");
    vi.stubEnv("OLLAMA_URL", "http://127.0.0.1:11434/v1");
    expect(availableProviders()).toContain("ollama");
  });

  it("calls the server's URL, never the tenant's", async () => {
    vi.stubEnv("OLLAMA_URL", "http://127.0.0.1:11434/v1");
    const fetchSpy = vi.fn(async () =>
      Response.json({
        id: "x",
        created: 0,
        model: "qwen3:8b",
        choices: [{ index: 0, message: { role: "assistant", content: "hola" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const model = await createModel({ provider: "ollama", model: "qwen3:8b", apiKey: "", baseUrl: "http://evil.example" });
    await generateText({ model, prompt: "hola", maxRetries: 0 });
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toBe("http://127.0.0.1:11434/v1/chat/completions");
  });
});
