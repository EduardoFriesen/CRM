import { generateText, InvalidToolInputError, NoSuchToolError, ToolChoiceViolationError, tool, wrapLanguageModel, type LanguageModel } from "ai";
import { z } from "zod";
import { toModelMessages, type HistoryTurn } from "@/bot/history";
import type { TurnUsage } from "@/bot/reply";
import type { FaqCall } from "./types";

export type RouterCall = FaqCall | { fn: "complex"; args: Record<string, never> };

export const ROUTER_TURNS = 3;

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
  catalog: none,
  greeting: none,
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
  catalog: "The customer asks to see the catalog, the price list or what products you sell (not one specific product).",
  greeting: "The message is only a greeting, with no question or request.",
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
- hours, location, payment_methods, shipping: preguntas frecuentes sobre el negocio. shipping es solo si hacen envíos, zonas o costo; un reclamo o consulta por un pedido ya hecho es handoff.
- Ingredientes, alérgenos o características de un producto no son stock: son complex.
- catalog: pide ver el catálogo, la lista de precios o qué productos venden, sin nombrar uno.
- greeting: el mensaje es SOLO un saludo (hola, buenas, cómo andan). Si además dice algo más, aunque sea vago ("hola, me interesa"), no es greeting.
- handoff: quiere comprar, pagar, reservar, hablar con una persona o hacer un reclamo (indicá el motivo).
- unclear: mensaje demasiado vago para saber qué quiere.
- complex: cualquier otra cosa que requiera una conversación.
No inventes datos.`;

const COMPLEX: RouterCall = { fn: "complex", args: {} };

export async function routeMessage(
  model: LanguageModel,
  turns: HistoryTurn[],
): Promise<{ call: RouterCall; usage: TurnUsage }> {
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
      instructions: INSTRUCTIONS,
      messages: toModelMessages(turns.slice(-ROUTER_TURNS), { toolCalls: false }),
      tools: TOOLS,
      toolChoice: "required",
      maxOutputTokens: 200,
      maxRetries: 0,
    });
    const tc = r.toolCalls[0];
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
