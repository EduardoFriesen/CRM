import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, generateText, type LanguageModel } from "ai";
import type { KeyStatus, Provider } from "@/db/schema";
import { assertSafeBaseUrl } from "./base-url";

export type ModelSettings = { provider: Provider; model: string; apiKey: string; baseUrl: string | null };
export type ModelFactory = (s: ModelSettings) => Promise<LanguageModel>;

// Suggestions only: the field is free text. Check each provider's docs for current model ids.
export const MODEL_SUGGESTIONS: Record<Provider, string[]> = {
  anthropic: ["claude-sonnet-5-5", "claude-haiku-5-5"],
  google: ["gemini-2.5-flash", "gemini-2.5-pro"],
  openai: ["gpt-4.1-mini", "gpt-4.1"],
  "openai-compatible": [],
};

async function fakeModel(): Promise<LanguageModel> {
  const { MockLanguageModelV4 } = await import("ai/test");
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: "Respuesta de prueba" }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

export const createModel: ModelFactory = async (s) => {
  // Test-only escape hatch for E2E; never honored in production builds.
  if (process.env.CRM_FAKE_MODEL === "1" && process.env.NODE_ENV !== "production") return fakeModel();
  switch (s.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: s.apiKey })(s.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: s.apiKey })(s.model);
    case "openai":
      return createOpenAI({ apiKey: s.apiKey })(s.model);
    case "openai-compatible": {
      const url = await assertSafeBaseUrl(s.baseUrl ?? "");
      return createOpenAICompatible({ name: "custom", baseURL: url.toString(), apiKey: s.apiKey })(s.model);
    }
  }
};

export const isAuthError = (e: unknown): boolean =>
  APICallError.isInstance(e) && (e.statusCode === 401 || e.statusCode === 403);

export async function verifyKey(s: ModelSettings, build: ModelFactory = createModel): Promise<KeyStatus> {
  try {
    await generateText({ model: await build(s), prompt: "ping", maxOutputTokens: 1, maxRetries: 0 });
    return "valid";
  } catch (e) {
    return isAuthError(e) ? "invalid" : "unverified";
  }
}
