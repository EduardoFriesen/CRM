import { z } from "zod";
import { WEBHOOK_SECRET_HEADER } from "./secret";

// Server-only client for Evolution API v2.3.7. The global API key never leaves the server.
export class EvolutionError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`Evolution request failed: ${path} (${status})`);
  }
}

export type ConnectionState = "open" | "close" | "connecting";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function call(path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const res = await fetch(`${env("EVOLUTION_URL")}${path}`, {
    method: init.method ?? "GET",
    headers: { apikey: env("EVOLUTION_API_KEY"), "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new EvolutionError(path, res.status);
  return res.json();
}

const name = (n: string) => encodeURIComponent(n);

export async function createInstance(instanceName: string, secret: string): Promise<void> {
  await call("/instance/create", {
    method: "POST",
    body: {
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      groupsIgnore: true,
      webhook: {
        enabled: true,
        url: `${env("CRM_INTERNAL_URL")}/api/webhooks/evolution/${name(instanceName)}`,
        byEvents: false,
        base64: false,
        headers: { [WEBHOOK_SECRET_HEADER]: secret },
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
      },
    },
  });
}

const connectResponse = z.object({ base64: z.string().optional() });

// While connecting Evolution returns the QR object; once open it returns the state instead.
export async function connect(instanceName: string): Promise<{ qrBase64: string | null }> {
  const body = connectResponse.parse(await call(`/instance/connect/${name(instanceName)}`));
  return { qrBase64: body.base64 ?? null };
}

const stateResponse = z.object({
  instance: z.object({ state: z.enum(["open", "close", "connecting"]) }),
});

export async function connectionState(instanceName: string): Promise<ConnectionState> {
  return stateResponse.parse(await call(`/instance/connectionState/${name(instanceName)}`)).instance.state;
}
