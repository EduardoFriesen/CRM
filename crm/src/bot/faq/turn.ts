import type { LanguageModel } from "ai";
import type { Stage } from "@/db/schema";
import type { HistoryTurn } from "@/bot/history";
import { classifyModelError, meter, type SkipOutcome, type TurnUsage } from "@/bot/reply";
import type { BotEvent, BotPath } from "@/usage/events";
import { answerFaq } from "./answers";
import { prefilter } from "./prefilter";
import { routeMessage } from "./router";
import { fill } from "./templates";
import type { FaqCall } from "./types";

export type TurnResult = {
  path: BotPath;
  fn: string | null;
  /** null = stay silent. */
  text: string | null;
  handoff: boolean;
  routerModel: string | null;
  usage: TurnUsage;
  routerUsage: TurnUsage;
  /** Set when a model call was skipped (no reply); the rest says how far the turn got. */
  skip?: SkipOutcome;
};

const zero = (): TurnUsage => ({ inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
const modelName = (m: LanguageModel) => (typeof m === "string" ? m : m.modelId);

/** A turn that reached `path` and has produced nothing yet. */
export function emptyTurn(path: BotPath): TurnResult {
  return { path, fn: null, text: null, handoff: false, routerModel: null, usage: zero(), routerUsage: zero() };
}

/** One metrics row per turn: both calls' tokens summed, the router's also apart. Never message text. */
export function turnEvent(contactId: string, outcome: string, r: TurnResult, model: string | null, latencyMs: number): BotEvent {
  return {
    contactId,
    path: r.path,
    fn: r.fn,
    model,
    routerModel: r.routerModel,
    inputTokens: r.usage.inputTokens + r.routerUsage.inputTokens,
    outputTokens: r.usage.outputTokens + r.routerUsage.outputTokens,
    cachedTokens: r.usage.cachedTokens + r.routerUsage.cachedTokens,
    routerInputTokens: r.routerUsage.inputTokens,
    routerOutputTokens: r.routerUsage.outputTokens,
    latencyMs,
    outcome,
  };
}

/**
 * Produces the text for one customer turn: silence, a template answer (pre-filter rule or
 * router), or the full bot (`runComplex`). Only Consulta uses the cheap paths.
 */
export async function answerTurn(
  tenantId: string,
  input: {
    turns: HistoryTurn[];
    stage: Stage;
    introduce: boolean;
    tenantName: string;
    routerModel: LanguageModel | null;
    runComplex: () => Promise<{ text: string; usage: TurnUsage } | SkipOutcome>;
    doHandoff: (reason: string) => Promise<void>;
    pick?: () => number;
  },
): Promise<TurnResult> {
  const base = emptyTurn("complex");
  const complex = async (r: TurnResult): Promise<TurnResult> => {
    const reply = await input.runComplex();
    return typeof reply === "string" ? { ...r, path: "complex", skip: reply } : { ...r, path: "complex", text: reply.text, usage: reply.usage };
  };
  if (input.stage !== "consulta") return complex(base);

  const lastOther = input.turns.findLastIndex((t) => t.role !== "user");
  const text = input.turns.slice(lastOther + 1).map((t) => t.text).join("\n");
  const decision = prefilter(text, lastOther >= 0 ? input.turns[lastOther].text : null);
  if (decision?.kind === "silence") return { ...base, path: "silence" };

  let call: FaqCall;
  let r: TurnResult;
  if (decision) {
    call = decision;
    r = { ...base, path: "prefilter", fn: decision.fn };
  } else {
    if (!input.routerModel) return complex(base);
    const routed = await route(tenantId, input.routerModel, input.turns);
    const routerModel = modelName(input.routerModel);
    if (typeof routed === "string") return { ...base, path: "faq", routerModel, skip: routed };
    r = { ...base, path: "faq", fn: routed.call.fn, routerModel, routerUsage: routed.usage };
    if (routed.call.fn === "complex") return complex({ ...r, fn: null });
    call = routed.call;
  }

  const out = await answerFaq(tenantId, call, input.pick);
  if (out === null) return complex(r);
  const answer = typeof out === "string" ? out : out.text;
  const reason = call.fn === "handoff" ? (call.args.reason ?? "El cliente quiere avanzar con una compra") : typeof out === "string" ? null : out.handoff;
  if (reason !== null) {
    await input.doHandoff(reason);
    r = { ...r, path: "handoff", handoff: true };
  }
  // A goodbye needs no introduction.
  if (!input.introduce || call.fn === "farewell") return { ...r, text: answer };
  // The introduction already greets and asks what they need: a greeting or unclear message gets only that.
  const intro = fill("intro", { tenant: input.tenantName }, input.pick);
  return { ...r, text: call.fn === "unclear" || call.fn === "greeting" ? intro : `${intro}\n${answer}` };
}

// The router call is metered and its errors classified like the main model's, except that a
// permanent error (unknown model, no tool support…) is recorded and routes to the full bot:
// a misconfigured router model must not silence the bot.
async function route(tenantId: string, model: LanguageModel, turns: HistoryTurn[]) {
  try {
    const routed = await routeMessage(model, turns);
    await meter(tenantId, { requests: 1, inputTokens: routed.usage.inputTokens, outputTokens: routed.usage.outputTokens });
    return routed;
  } catch (e) {
    await meter(tenantId, { requests: 1 });
    const skip = await classifyModelError(tenantId, e);
    return skip === "skipped:model-error" ? { call: { fn: "complex", args: {} } as const, usage: zero() } : skip;
  }
}
