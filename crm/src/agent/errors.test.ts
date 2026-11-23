import { describe, expect, it } from "vitest";
import { describeAgentError } from "@/agent/errors";

describe("describeAgentError", () => {
  it("explains an exhausted quota in plain words", () => {
    expect(describeAgentError("QUOTA_EXCEEDED")).toMatch(/cuota/i);
    expect(describeAgentError("HTTP_429")).toMatch(/límite de uso/i);
  });
  it("explains a failed verification", () => {
    expect(describeAgentError("VERIFY_TIMEOUT")).toMatch(/no respondió a tiempo/);
    expect(describeAgentError("VERIFY_HTTP_503")).toMatch(/HTTP_503/);
  });
  it("falls back to the raw code", () => expect(describeAgentError("EVOLUTION_500")).toContain("EVOLUTION_500"));
});
