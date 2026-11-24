import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, generateText, RetryError, type LanguageModel } from "ai";
import { PROVIDERS, type KeyStatus, type Provider } from "@/db/schema";
import { assertSafeBaseUrl, safeFetch } from "./base-url";

export type ModelSettings = { provider: Provider; model: string; apiKey: string; baseUrl: string | null };
export type ModelFactory = (s: ModelSettings) => Promise<LanguageModel>;

// Suggestions only: the field is free text. Check each provider's docs for current model ids.
export const MODEL_SUGGESTIONS: Record<Provider, string[]> = {
  anthropic: ["claude-sonnet-5-5", "claude-haiku-5-5"],
  google: ["gemini-3.5-flash", "gemini-3.5-flash-lite"],
  openai: ["gpt-4.1-mini", "gpt-4.1"],
  "openai-compatible": [],
  ollama: ["qwen3:8b", "llama3.1:8b"],
};

// Cheap models for the FAQ router.
export const ROUTER_SUGGESTIONS: Record<Provider, string[]> = {
  anthropic: ["claude-haiku-5-5"],
  google: ["gemini-3.5-flash-lite"],
  openai: ["gpt-4.1-mini"],
  "openai-compatible": [],
  ollama: [],
};

// Local Ollama exists only where the server sets OLLAMA_URL (the dev compose override).
// The URL is the server's, never the tenant's, so it may point at a private address.
export const ollamaUrl = (): string | null => process.env.OLLAMA_URL || null;

export const availableProviders = (): Provider[] => PROVIDERS.filter((p) => p !== "ollama" || ollamaUrl() !== null);

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
      return createOpenAICompatible({ name: "custom", baseURL: url.toString(), apiKey: s.apiKey, fetch: safeFetch })(s.model);
    }
    case "ollama": {
      const baseURL = ollamaUrl();
      // A tenant saved on a dev server that now runs without Ollama: permanent, not retryable.
      if (!baseURL) throw Object.assign(new Error("OLLAMA_UNAVAILABLE"), { code: "OLLAMA_UNAVAILABLE" });
      // Thinking off: qwen3 spends 4x longer reasoning per reply; non-thinking models ignore it.
      return createOpenAICompatible({
        name: "ollama",
        baseURL,
        transformRequestBody: (body) => ({ ...body, reasoning_effort: "none" }),
      })(s.model);
    }
  }
};

// Gemini answers a bad key with 400 INVALID_ARGUMENT / API_KEY_INVALID instead of 401.
export const isAuthError = (e: unknown): boolean =>
  APICallError.isInstance(e) &&
  (e.statusCode === 401 ||
    e.statusCode === 403 ||
    (e.statusCode === 400 && /API_KEY_INVALID|API key not valid/i.test(`${e.responseBody ?? ""} ${e.message}`)));

const unwrap = (e: unknown): unknown => (RetryError.isInstance(e) ? e.lastError : e);

// A 429 that won't clear in minutes: a daily quota (Gemini free tier) or no credit left
// (OpenAI insufficient_quota). Retrying only burns more of it.
export function isQuotaExhausted(e: unknown): boolean {
  const err = unwrap(e);
  return (
    APICallError.isInstance(err) &&
    err.statusCode === 429 &&
    /PerDay|insufficient_quota/i.test(`${err.responseBody ?? ""} ${err.message}`)
  );
}

// "quota": the provider accepted the key but refused on usage limits.
export type KeyCheck = KeyStatus | "quota";

export type KeyCheckResult = { status: KeyCheck; code: string | null };

// The save request goes through nginx (60 s): stay well under it even when the provider is slow.
const VERIFY_TIMEOUT_MS = 20_000;

const failureCode = (err: unknown): string => {
  if (APICallError.isInstance(err)) return `HTTP_${err.statusCode ?? "NETWORK"}`;
  const name = (err as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : String(name ?? "UNKNOWN");
};

export async function verifyKeyDetailed(
  s: ModelSettings,
  build: ModelFactory = createModel,
  timeoutMs = VERIFY_TIMEOUT_MS,
): Promise<KeyCheckResult> {
  try {
    await generateText({
      model: await build(s),
      prompt: "ping",
      maxOutputTokens: 1,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    return { status: "valid", code: null };
  } catch (e) {
    const err = unwrap(e);
    if (isAuthError(err)) return { status: "invalid", code: failureCode(err) };
    if (APICallError.isInstance(err) && err.statusCode === 429) return { status: "quota", code: "HTTP_429" };
    return { status: "unverified", code: failureCode(err) };
  }
}

export async function verifyKey(s: ModelSettings, build: ModelFactory = createModel): Promise<KeyCheck> {
  return (await verifyKeyDetailed(s, build)).status;
}
