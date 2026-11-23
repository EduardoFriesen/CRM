import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { assertSafeBaseUrl, guardedLookup, safeFetch, UnsafeBaseUrlError } from "@/agent/base-url";

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
    ["benchmark range", "https://bench.example.com/v1", ["198.18.0.1"]],
    ["multicast", "https://mc.example.com/v1", ["224.0.0.1"]],
    ["reserved", "https://res.example.com/v1", ["240.0.0.1"]],
    ["ipv6 site-local", "https://sl.example.com/v1", ["fec0::1"]],
    ["nat64", "https://nat.example.com/v1", ["64:ff9b::a00:1"]],
    ["6to4", "https://sixto4.example.com/v1", ["2002:a00:1::1"]],
    ["not a url", "not a url", []],
  ])("rejects %s", async (_label, url, ips) => {
    await expect(assertSafeBaseUrl(url, resolvesTo(...ips))).rejects.toBeInstanceOf(UnsafeBaseUrlError);
  });
});

describe("connection-time guard", () => {
  const lookupWith =
    (...ips: string[]) =>
    (_h: string, _o: object, cb: (e: Error | null, a?: { address: string; family: number }[]) => void) =>
      cb(null, ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));

  it("refuses to connect when the host now resolves to a private address (DNS rebinding)", async () => {
    const lookup = guardedLookup(lookupWith("10.0.0.7"));
    const err = await new Promise<Error | null>((resolve) => lookup("api.example.com", { all: true }, (e) => resolve(e)));
    expect(err).toBeInstanceOf(UnsafeBaseUrlError);
  });

  it("lets public addresses through", async () => {
    const lookup = guardedLookup(lookupWith("104.18.0.1"));
    const addrs = await new Promise<unknown>((resolve) => lookup("api.example.com", { all: true }, (_e, a) => resolve(a)));
    expect(addrs).toEqual([{ address: "104.18.0.1", family: 4 }]);
  });

  it("never follows redirects", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(302, { location: "http://evolution-api:8080/instance/fetchInstances" });
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(safeFetch(`http://127.0.0.1:${port}/v1/chat`)).rejects.toThrow();
    } finally {
      server.close();
    }
  });
});
