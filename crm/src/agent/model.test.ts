import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { verifyKey, type ModelSettings } from "@/agent/model";

const settings: ModelSettings = { provider: "anthropic", model: "claude-haiku-5-5", apiKey: "sk-x", baseUrl: null };
const failing = (error: unknown) => async () =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
  });

describe("verifyKey", () => {
  it("reports invalid when the provider rejects the key", async () => {
    const e = new APICallError({ message: "unauthorized", url: "https://x", requestBodyValues: {}, statusCode: 401 });
    expect(await verifyKey(settings, failing(e))).toBe("invalid");
  });

  it("reports invalid when Gemini rejects the key with a 400", async () => {
    const e = new APICallError({
      message: "API key not valid. Please pass a valid API key.",
      url: "https://generativelanguage.googleapis.com",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: '{"error":{"code":400,"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}',
    });
    expect(await verifyKey({ ...settings, provider: "google" }, failing(e))).toBe("invalid");
  });

  it("reports unverified on network errors", async () => {
    expect(await verifyKey(settings, failing(new TypeError("fetch failed")))).toBe("unverified");
  });

  it("reports valid when the call succeeds", async () => {
    const ok = async () =>
      new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [{ type: "text", text: "ok" }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
          warnings: [],
        }),
      });
    expect(await verifyKey(settings, ok)).toBe("valid");
  });
});
