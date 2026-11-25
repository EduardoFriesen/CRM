import { generateText, InvalidToolInputError, NoSuchToolError, ToolChoiceViolationError, tool, wrapLanguageModel, type LanguageModel } from "ai";
import { z } from "zod";
import { toModelMessages, type HistoryTurn } from "@/bot/history";
import type { TurnUsage } from "@/bot/reply";
import type { RouterExample } from "./examples";
import type { FaqCall } from "./types";

export type RouterCall = FaqCall | { fn: "complex"; args: Record<string, never> };

export const ROUTER_TURNS = 3;
export const ROUTER_FACTS = 30;
export const ROUTER_EXAMPLES = 20;

export type RouterContext = {
  facts?: { id?: string; question: string }[];
  examples?: Pick<RouterExample, "text" | "fn" | "factId">[];
};
const CLIP = 120;
const clip = (s: string) => (s.length > CLIP ? `${s.slice(0, CLIP)}…` : s);

const product = z.object({ product: z.string().trim().min(1).max(100) });
const none = z.object({});

const SCHEMAS = {
  price: product,
  stock: product,
  hours: none,
  location: none,
  payment_methods: none,
  shipping: z.object({ zone: z.string().max(100).optional() }),
  handoff: z.object({ reason: z.string().trim().min(1).max(300) }),
  quote: z.object({
    items: z
      .array(z.object({ product: z.string().trim().min(1).max(100), quantity: z.number().positive().max(1_000_000) }))
      .min(1)
      .max(10),
  }),
  catalog: none,
  greeting: none,
  farewell: none,
  order_status: none,
  unclear: none,
  complex: none,
} as const;

const DESCRIPTIONS: Record<keyof typeof SCHEMAS, string> = {
  price: "The customer asks the price of a product.",
  stock: "The customer asks whether a product is available (not its ingredients, allergens or features).",
  hours: "The customer asks the opening hours.",
  location: "The customer asks where the business is or how to get there.",
  payment_methods: "The customer asks which payment methods are accepted.",
  shipping: "General questions about whether you ship, zones or shipping cost (not complaints or questions about a specific order).",
  handoff: "The customer wants to buy, pay, reserve, talk to a person or complain.",
  quote: "The customer asks the total for a quantity of one or more products, or says they want a quantity of a product.",
  catalog: "The customer asks to see the catalog, the price list or what products you sell (not one specific product).",
  greeting: "The message is only a greeting, with no question or request.",
  farewell: "The message is only a goodbye, with no question or request.",
  order_status: "The customer asks when their order arrives, where it is or its status (not a complaint).",
  unclear: "The message is too vague to tell what the customer wants.",
  complex: "Anything else that needs a real conversation.",
};

const TOOLS = Object.fromEntries(
  (Object.keys(SCHEMAS) as (keyof typeof SCHEMAS)[]).map((n) => [
    n,
    tool({ description: DESCRIPTIONS[n], inputSchema: SCHEMAS[n] as z.ZodType<Record<string, unknown>> }),
  ]),
);

const INSTRUCTIONS = `Sos un clasificador de mensajes de clientes de un negocio por WhatsApp.
Elegí exactamente una función según el ÚLTIMO mensaje del cliente; el contexto previo solo sirve para entenderlo.
- price / stock: pregunta por el precio o la disponibilidad de un producto (indicá el producto).
- hours, location, payment_methods, shipping: preguntas frecuentes sobre el negocio. shipping es solo si hacen envíos, zonas o costo (no un pedido ya hecho).
- Ingredientes, alérgenos o características de un producto no son stock: son complex.
- quote: pide cuánto sale una cantidad de uno o más productos, o dice que quiere una cantidad ("quiero 300 m2 de kikuyo", "quiero comprar 2 panes"). Indicá cada producto y su cantidad como número.
- catalog: pide ver el catálogo, la lista de precios o qué productos venden, sin nombrar uno.
- greeting: el mensaje es SOLO un saludo (hola, buenas, cómo andan). Si además dice algo más, aunque sea vago ("hola, me interesa"), no es greeting.
- farewell: el mensaje es SOLO una despedida (chau, hasta luego). Si además pide algo, no es farewell.
- order_status: pregunta cuándo llega, dónde está o en qué estado está SU pedido. Un reclamo (llegó mal, no llegó, falta algo) es handoff.
- handoff: quiere comprar sin decir cantidad, pagar, reservar, hablar con una persona o hacer un reclamo (indicá el motivo).
- unclear: mensaje demasiado vago para saber qué quiere.
- complex: cualquier otra cosa que requiera una conversación.
No inventes datos.`;

const COMPLEX: RouterCall = { fn: "complex", args: {} };

// Offered only when the business has learned answers; `n` is the question's number in the prompt.
const LEARNED = z.object({ n: z.number().int().min(1) });
const LEARNED_TOOL = tool({ description: "The customer asks the same as one of the questions the business already answered.", inputSchema: LEARNED });

// A learned shortcut is shown by its fact's number; one whose fact is not in the list is left out.
function examplesSection(examples: RouterContext["examples"] = [], facts: { id?: string }[]): string {
  const lines = examples.slice(0, ROUTER_EXAMPLES).flatMap((e) => {
    if (e.fn !== "learned") return [`"${clip(e.text)}" → ${e.fn}`];
    const n = facts.findIndex((f) => f.id !== undefined && f.id === e.factId) + 1;
    return n > 0 ? [`"${clip(e.text)}" → learned ${n}`] : [];
  });
  return lines.length ? `\nEjemplos de este negocio:\n${lines.join("\n")}` : "";
}

function learnedSection(facts: { question: string }[]): string {
  if (facts.length === 0) return "";
  const list = facts.map((f, i) => `${i + 1}. ${clip(f.question)}`).join("\n");
  return `\n- learned: el cliente pregunta lo mismo que una de las preguntas ya respondidas (aunque con otras palabras); indicá su número. Si no es claramente la misma, no la elijas.\nPreguntas ya respondidas por el negocio:\n${list}`;
}

export async function routeMessage(
  model: LanguageModel,
  turns: HistoryTurn[],
  ctx: RouterContext = {},
): Promise<{ call: RouterCall; usage: TurnUsage }> {
  const facts = (ctx.facts ?? []).slice(0, ROUTER_FACTS);
  // The SDK throws on malformed output and drops the usage with it; read it off the raw provider result.
  const usage: TurnUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  const metered = wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      specificationVersion: "v4",
      wrapGenerate: async ({ doGenerate }) => {
        const res = await doGenerate();
        usage.inputTokens += res.usage.inputTokens.total ?? 0;
        usage.outputTokens += res.usage.outputTokens.total ?? 0;
        usage.cachedTokens += res.usage.inputTokens.cacheRead ?? 0;
        return res;
      },
    },
  });
  try {
    const r = await generateText({
      model: metered,
      instructions: INSTRUCTIONS + learnedSection(facts) + examplesSection(ctx.examples, facts),
      messages: toModelMessages(turns.slice(-ROUTER_TURNS), { toolCalls: false }),
      tools: facts.length ? { ...TOOLS, learned: LEARNED_TOOL } : TOOLS,
      toolChoice: "required",
      maxOutputTokens: 200,
      maxRetries: 0,
    });
    const tc = r.toolCalls[0];
    if (tc?.toolName === "learned") {
      const l = LEARNED.safeParse(tc.input);
      return { call: l.success && l.data.n <= facts.length ? { fn: "learned", args: { n: l.data.n } } : COMPLEX, usage };
    }
    const schema = tc && tc.toolName in SCHEMAS ? SCHEMAS[tc.toolName as keyof typeof SCHEMAS] : undefined;
    const parsed = schema?.safeParse(tc.input);
    return { call: parsed?.success ? ({ fn: tc.toolName, args: parsed.data } as RouterCall) : COMPLEX, usage };
  } catch (e) {
    // Malformed model output is a routing miss, not a provider failure.
    if (NoSuchToolError.isInstance(e) || InvalidToolInputError.isInstance(e) || ToolChoiceViolationError.isInstance(e)) {
      return { call: COMPLEX, usage };
    }
    throw e;
  }
}
