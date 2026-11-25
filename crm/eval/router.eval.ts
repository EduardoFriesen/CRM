import { expect, it } from "vitest";
import { createModel } from "@/agent/model";
import type { HistoryTurn } from "@/bot/history";
import { prefilter } from "@/bot/faq/prefilter";
import { routeMessage } from "@/bot/faq/router";

const MODEL = process.env.EVAL_MODEL ?? "qwen3:8b";
const MIN_ACCURACY = 0.8;

type Expected = string; // an FAQ name, "complex" or "silence"
type Case = { text: string; before?: HistoryTurn[]; facts?: { question: string }[]; expected: Expected };

const FACTS = [{ question: "¿Hacen factura A?" }, { question: "¿Tienen estacionamiento?" }];

// Complaints and purchase/payment/reservation requests are `handoff` (see the router instructions).
const cases: Case[] = [
  { text: "cuanto sale el pan de campo?", expected: "price" },
  { text: "q precio tiene la torta\nde chocolate", expected: "price" },
  { text: "cuanto cuesta el alfajor", expected: "price" },
  { text: "tienen pan de campo?", expected: "stock" },
  { text: "hay stock de facturas", expected: "stock" },
  { text: "te quedan medialunas?", expected: "stock" },
  { text: "a q hora abren los sabados", expected: "hours" },
  { text: "orario de atencion?", expected: "hours" },
  { text: "hasta q hora atienden hoy", expected: "hours" },
  { text: "donde quedan?", expected: "location" },
  { text: "como llego a su local", expected: "location" },
  { text: "aceptan tarjeta?", expected: "payment_methods" },
  { text: "se puede pagar con mercadopago", expected: "payment_methods" },
  { text: "hacen envios a pilar?", expected: "shipping" },
  { text: "llevan a domicilio?", expected: "shipping" },
  { text: "xq no hay delivery a mi barrio", expected: "shipping" },
  { text: "pasame el alias", expected: "handoff" },
  { text: "quiero comprar 2 panes", expected: "quote" },
  { text: "quiero 300 m2 de kikuyo", expected: "quote" },
  { text: "cuanto me sale 10 tornillos y 5 clavos?", expected: "quote" },
  {
    text: "cuanto serian por 300 m2?",
    before: [{ role: "user", text: "precio del kikuyo?" }, { role: "assistant", text: "Kikuyo sale $10.000." }],
    expected: "quote",
  },
  { text: "quiero comprar", expected: "handoff" },
  { text: "chau, gracias", expected: "farewell" },
  { text: "bueno me voy, hasta la proxima", expected: "farewell" },
  { text: "cuando me llega el pedido?", expected: "order_status" },
  { text: "mi pedido llego roto", expected: "handoff" },
  { text: "emiten factura a?", facts: FACTS, expected: "learned" },
  { text: "hay lugar para estacionar?", facts: FACTS, expected: "learned" },
  { text: "hacen factura B?", facts: FACTS, expected: "complex" },
  { text: "mi envio no llego", expected: "handoff" },
  { text: "quiero hablar con una persona", expected: "handoff" },
  { text: "eso", expected: "unclear" },
  { text: "y de ese?", expected: "unclear" },
  { text: "hola\nme interesa", expected: "unclear" },
  { text: "hola", expected: "greeting" },
  { text: "buenas tardes!", expected: "greeting" },
  { text: "holaa como andan", expected: "greeting" },
  { text: "queria consultar el catalogo de productos", expected: "catalog" },
  { text: "que productos tienen?", expected: "catalog" },
  { text: "pasame la lista de precios", expected: "catalog" },
  { text: "q diferencia hay entre el pan de campo y el integral?", expected: "complex" },
  { text: "tiene gluten el pan de campo?", expected: "complex" },
  { text: "me recomendas algo para regalar a mi suegra?", expected: "complex" },
  // Held-out: added after the prompt was tuned, phrasings the instructions do not quote.
  { text: "mi pedido llego mal", expected: "handoff" },
  { text: "el paquete nunca me llego", expected: "handoff" },
  { text: "tiene lactosa la torta?", expected: "complex" },
  { text: "ok gracias", expected: "silence" },
  { text: "dale 👍", expected: "silence" },
  {
    text: "listo\ngracias",
    before: [{ role: "assistant", text: "Te esperamos hasta las 20." }],
    expected: "silence",
  },
  {
    text: "dale",
    before: [{ role: "assistant", text: "¿Querés que te pase el precio?" }],
    expected: "complex", // the bot asked a question, so "dale" is an answer, not a courtesy
  },
];

async function route(model: Awaited<ReturnType<typeof createModel>>, c: Case): Promise<string> {
  const lastBot = [...(c.before ?? [])].reverse().find((t) => t.role === "assistant")?.text ?? null;
  const pre = prefilter(c.text, lastBot);
  if (pre) return pre.kind === "silence" ? "silence" : pre.fn;
  const { call } = await routeMessage(model, [...(c.before ?? []), { role: "user", text: c.text }], { facts: c.facts });
  return call.fn;
}

it(`router accuracy (${MODEL})`, async () => {
  const url = process.env.OLLAMA_URL ?? "";
  const up = await fetch(new URL("/api/version", url)).then((r) => r.ok, () => false);
  if (!up) throw new Error(`Ollama no responde en ${url}: arrancalo con \`sudo systemctl start ollama\``);
  const model = await createModel({ provider: "ollama", model: MODEL, apiKey: "", baseUrl: null });

  const per = new Map<string, { ok: number; total: number }>();
  const misses: string[] = [];
  let ok = 0;
  for (const c of cases) {
    const got = await route(model, c);
    const s = per.get(c.expected) ?? { ok: 0, total: 0 };
    s.total++;
    if (got === c.expected) {
      s.ok++;
      ok++;
    } else misses.push(`${JSON.stringify(c.text)}: expected ${c.expected}, got ${got}`);
    per.set(c.expected, s);
  }

  const accuracy = ok / cases.length;
  console.log(`\nRouter accuracy: ${ok}/${cases.length} (${(accuracy * 100).toFixed(0)}%)`);
  for (const [fn, s] of per) console.log(`  ${fn}: ${s.ok}/${s.total}`);
  console.log(misses.length ? `Misses:\n  ${misses.join("\n  ")}` : "No misses");
  expect(accuracy).toBeGreaterThanOrEqual(MIN_ACCURACY);
});
