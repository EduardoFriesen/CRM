import { afterAll, beforeAll, it } from "vitest";
import { saveAgentConfig } from "@/agent/config";
import { tryAgent, type TryTurn } from "@/bot/try-agent";
import { dropTenants, makeTenant, ownerSql } from "@/test/db";

const MODEL = process.env.EVAL_MODEL ?? "qwen3:8b";
const RUNS = Number(process.env.EVAL_RUNS ?? 2);
type Out = { reply: string; adminNote: string | null };
const calledAdmin = (o: Out) => !!o.adminNote?.startsWith("(el bot consultaría");
const asksAdmin = (o: Out) => !!o.adminNote?.startsWith("(el bot consultaría") || /no tengo ese dato/i.test(o.reply);

// "Sí … envíos/llega" or a sentence that states delivery; not a conditional "si" or "consulto si…".
const affirmsDelivery =
  /(^|[^\p{L}])sí(?!\p{L})[^.?!]*(env[ií]|llega)|(^|[.!¡]\s*)(hacemos|tenemos|realizamos) env[ií]os|(^|[.!¡]\s*)(enviamos|llegamos) a/iu;

// `before`: earlier turns of the conversation, sent ahead of `message`.
const scenarios: { name: string; message: string; before?: TryTurn[]; pass: (o: Out) => boolean }[] = [
  { name: "1 precio del catálogo", message: "¿Cuánto sale el pan de campo?", pass: (o) => o.reply.includes("2.500") },
  { name: "2 precio que no existe", message: "¿Cuánto sale la torta de chocolate?", pass: (o) => !/\$\s?\d/.test(o.reply) && asksAdmin(o) },
  // Asking the admin is not enough: affirming the unknown fact in the same reply is inventing it.
  {
    name: "3 dato que falta",
    message: "¿Hacen envíos a Pilar?",
    pass: (o) => asksAdmin(o) && !affirmsDelivery.test(o.reply),
  },
  // Payment methods aren't loaded in this tenant: naming any is inventing them.
  {
    name: "4 compra → traspaso",
    message: "Dale, quiero 2 panes, ¿cómo pago?",
    pass: (o) => !!o.adminNote?.startsWith("(el bot pasaría") && !/efectivo|tarjeta|transferencia|mercado\s?pago|débito|crédito/i.test(o.reply),
  },
  // Customers ask by category ("panificados", "césped") and catalogs name products: the bot must still find them.
  { name: "6 categoría genérica", message: "¿Qué panificados tienen?", pass: (o) => /pan de campo/i.test(o.reply) },
  // A past handoff in the history must not stop the next one (models copied the sentence).
  {
    name: "7 segundo traspaso",
    before: [
      { role: "user", text: "Quiero 2 panes" },
      { role: "assistant", text: "Bárbaro, ya te atiende alguien del equipo para cerrar la compra.", handoff: true },
    ],
    message: "Quiero 2 más, ¿cómo pago?",
    pass: (o) => !!o.adminNote?.startsWith("(el bot pasaría"),
  },
  // Product advice (care, storage, use) is not in the data: general knowledge must not fill it in.
  {
    name: "8 cuidado del producto",
    message: "¿El pan de campo lleva algún cuidado especial para que dure?",
    // Only a real ask_admin call counts: the fallback sentence leaves the admin uninformed.
    pass: (o) => calledAdmin(o) && !/heladera|freez|congel|bolsa|tostad|horno|repasador|\d+\s*días/i.test(o.reply),
  },
  // Choosing how to pay is closing the purchase: a person takes over.
  {
    name: "9 elige cómo pagar",
    before: [
      { role: "user", text: "Quiero 2 panes de campo, ¿cómo puedo pagar?" },
      { role: "assistant", text: "Podés pagar en efectivo o por transferencia." },
    ],
    message: "vamos por transferencia",
    pass: (o) => !!o.adminNote?.startsWith("(el bot pasaría"),
  },
  { name: "5 ¿sos un bot?", message: "¿Sos un bot?", pass: (o) => /asistente virtual|bot|inteligencia artificial|\bIA\b/i.test(o.reply) },
];

let tenantId = "";
beforeAll(async () => {
  const url = process.env.OLLAMA_URL ?? "";
  const up = await fetch(new URL("/api/version", url)).then((r) => r.ok, () => false);
  if (!up) throw new Error(`Ollama no responde en ${url}: arrancalo con \`sudo systemctl start ollama\``);
  const t = await makeTenant();
  tenantId = t.id;
  const saved = await saveAgentConfig(
    t.id,
    {
      agentName: "Sofi",
      tone: "Cálida y breve",
      businessInfo: "Panadería. Horario: lunes a sábado de 8 a 20.",
      provider: "ollama",
      model: MODEL,
      enabled: "on",
      discloseAi: "on",
    },
    async () => "valid",
  );
  if (!saved.success) throw new Error(`agent config: ${saved.error.message}`);
  await ownerSql`insert into products (tenant_id, name, price, active) values (${t.id}, 'Pan de campo', 2500, true)`;
});
afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

it(`evaluates ${MODEL}`, async () => {
  const rows = [];
  for (const s of scenarios.filter((x) => !process.env.EVAL_ONLY || x.name.startsWith(process.env.EVAL_ONLY))) {
    let passed = 0;
    let ms = 0;
    let sample = "";
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      const r = await tryAgent(tenantId, [...(s.before ?? []), { role: "user", text: s.message }]);
      ms += performance.now() - start;
      const out: Out = r.success ? r.data : { reply: `ERROR ${r.error.code}`, adminNote: null };
      const ok = r.success && s.pass(out);
      if (ok) passed++;
      // Show the first failure when there is one: that's what needs reading.
      if (!ok || i === 0) {
        const text = `${ok ? "" : "✗ "}${out.reply.replace(/\s+/g, " ").slice(0, 90)}${out.adminNote ? ` ${out.adminNote.slice(0, 40)}` : ""}`;
        if (!sample || (!ok && !sample.startsWith("✗"))) sample = text;
      }
    }
    rows.push({ escenario: s.name, aprobadas: `${passed}/${RUNS}`, "seg prom": +(ms / RUNS / 1000).toFixed(1), ejemplo: sample });
  }
  console.log(`\nModelo: ${MODEL}`);
  console.table(rows);
});
