import { lookup as dnsLookupCb, type LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import { BlockList, isIP, type LookupFunction } from "node:net";

// Anti-SSRF for tenant-provided "OpenAI-compatible" endpoints: https only, and every
// address the host resolves to must be public. Checked on save and before each use.
export class UnsafeBaseUrlError extends Error {}

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [
  ["::1", 128],
  ["::", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["64:ff9b::", 96],
  ["2002::", 16],
] as const) {
  blocked.addSubnet(net, bits, "ipv6");
}

// IPv4-mapped IPv6 (::ffff:a.b.c.d) is unwrapped and checked as IPv4; adding ::ffff:0:0/96
// to the BlockList would make Node match every IPv4 address.
function isPrivate(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (mapped) return blocked.check(mapped, "ipv4");
  return blocked.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
}

type Lookup = (host: string) => Promise<string[]>;
const dnsLookup: Lookup = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

export async function assertSafeBaseUrl(raw: string, resolve: Lookup = dnsLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeBaseUrlError("URL inválida");
  }
  if (url.protocol !== "https:") throw new UnsafeBaseUrlError("La URL tiene que empezar con https://");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!isIP(host) && !host.includes(".")) throw new UnsafeBaseUrlError("El host no es público");
  const ips = isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (ips.length === 0 || ips.some(isPrivate)) throw new UnsafeBaseUrlError("El host no es público");
  return url;
}

type LookupCallback = (err: Error | null, address?: string | LookupAddress[], family?: number) => void;
type LookupFn = (hostname: string, options: { all: true }, cb: (err: Error | null, addrs?: LookupAddress[]) => void) => void;
const systemLookup: LookupFn = (hostname, options, cb) => dnsLookupCb(hostname, options, cb);

// Re-checks the addresses at connect time, so a host that passed assertSafeBaseUrl and then
// re-resolves to a private IP (DNS rebinding) is refused before any byte is sent.
export function guardedLookup(resolve: LookupFn = systemLookup) {
  return (hostname: string, options: { all?: boolean }, cb: LookupCallback) => {
    resolve(hostname, { all: true }, (err, addrs = []) => {
      if (err) return cb(err);
      if (addrs.length === 0 || addrs.some((a) => isPrivate(a.address))) {
        return cb(new UnsafeBaseUrlError("El host no es público"));
      }
      if (options.all) return cb(null, addrs);
      cb(null, addrs[0].address, addrs[0].family);
    });
  };
}

// Same runtime contract as net.LookupFunction; the cast only reconciles overload typings.
const guardedAgent = new Agent({ connect: { lookup: guardedLookup() as unknown as LookupFunction } });

// fetch for tenant-provided endpoints: connect-time IP check and no redirects (a public
// host could otherwise 30x to http://evolution-api:8080 or a metadata service).
export const safeFetch = ((input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) =>
  undiciFetch(input, { ...init, redirect: "error", dispatcher: guardedAgent })) as unknown as typeof fetch;
