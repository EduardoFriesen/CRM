import { describe, expect, it } from "vitest";
import { assertSafeBaseUrl, UnsafeBaseUrlError } from "@/agent/base-url";

const resolvesTo = (...ips: string[]) => async () => ips;

describe("assertSafeBaseUrl", () => {
  it("accepts a public https endpoint", async () => {
    const url = await assertSafeBaseUrl("https://api.groq.com/openai/v1", resolvesTo("104.18.0.1"));
    expect(url.hostname).toBe("api.groq.com");
  });

  it.each([
    ["plain http", "http://api.groq.com/openai/v1", ["104.18.0.1"]],
    ["docker service name", "https://evolution-api/v1", ["172.18.0.3"]],
    ["loopback literal", "https://127.0.0.1/v1", []],
    ["private literal", "https://10.0.0.5/v1", []],
    ["ipv6 loopback", "https://[::1]/v1", []],
    ["host resolving to private", "https://evil.example.com/v1", ["192.168.1.10"]],
    ["one private among public", "https://mixed.example.com/v1", ["8.8.8.8", "10.1.1.1"]],
    ["cgnat", "https://cg.example.com/v1", ["100.64.0.1"]],
    ["cloud metadata", "https://meta.example.com/v1", ["169.254.169.254"]],
    ["ipv6 unique local", "https://ula.example.com/v1", ["fd00::1"]],
    ["ipv4-mapped private", "https://mapped.example.com/v1", ["::ffff:10.0.0.1"]],
    ["not a url", "not a url", []],
  ])("rejects %s", async (_label, url, ips) => {
    await expect(assertSafeBaseUrl(url, resolvesTo(...ips))).rejects.toBeInstanceOf(UnsafeBaseUrlError);
  });
});
