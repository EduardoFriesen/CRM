import { withTenant } from "@/db/client";
import { botEvents, type BOT_PATHS } from "@/db/schema";

export type BotPath = (typeof BOT_PATHS)[number];

export type BotEvent = {
  contactId: string;
  path: BotPath;
  fn: string | null;
  model: string | null;
  routerModel: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  routerInputTokens: number;
  routerOutputTokens: number;
  latencyMs: number;
  outcome: string;
};

// Only an error code is logged: never message text, phone numbers or keys.
function codeOf(e: unknown): string {
  const err = e as { code?: unknown; name?: unknown; cause?: { code?: unknown } } | null;
  return String(err?.cause?.code ?? err?.code ?? err?.name ?? "UNKNOWN");
}

// One metrics row per bot turn. Like meter(): a failure here must never break a reply.
export async function recordBotEvent(tenantId: string, e: BotEvent): Promise<void> {
  try {
    await withTenant(tenantId, (tx) => tx.insert(botEvents).values({ tenantId, ...e }));
  } catch (err) {
    console.error(`bot event failed: ${codeOf(err)}`);
  }
}
