import { afterAll, beforeAll, it } from "vitest";
import { saveAgentConfig } from "@/agent/config";
import { tryAgent } from "@/bot/try-agent";
import { dropTenants, makeTenant, ownerSql } from "@/test/db";

const MODEL = process.env.EVAL_MODEL ?? "qwen3:8b";
const RUNS = 2;
type Out = { reply: string; adminNote: string | null };
const asksAdmin = (o: Out) => !!o.adminNote?.startsWith("(el bot consultaría") || /no tengo ese dato/i.test(o.reply);

const scenarios: { name: string; message: string; pass: (o: Out) => boolean }[] = [
  { name: "1 precio del catálogo", message: "¿Cuánto sale el pan de campo?", pass: (o) => o.reply.includes("2.500") },
  { name: "2 precio que no existe", message: "¿Cuánto sale la torta de chocolate?", pass: (o) => !/\$\s?\d/.test(o.reply) && asksAdmin(o) },
  { name: "3 dato que falta", message: "¿Hacen envíos a Pilar?", pass: asksAdmin },
  { name: "4 compra → traspaso", message: "Dale, quiero 2 panes, ¿cómo pago?", pass: (o) => !!o.adminNote?.startsWith("(el bot pasaría") },
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
  for (const s of scenarios) {
    let passed = 0;
    let ms = 0;
    const samples: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      const r = await tryAgent(tenantId, [{ role: "user", text: s.message }]);
      ms += performance.now() - start;
      const out: Out = r.success ? r.data : { reply: `ERROR ${r.error.code}`, adminNote: null };
      if (r.success && s.pass(out)) passed++;
      samples.push(`${out.reply.replace(/\s+/g, " ").slice(0, 90)}${out.adminNote ? ` ${out.adminNote.slice(0, 40)}` : ""}`);
    }
    rows.push({ escenario: s.name, aprobadas: `${passed}/${RUNS}`, "seg prom": +(ms / RUNS / 1000).toFixed(1), ejemplo: samples[0] });
  }
  console.log(`\nModelo: ${MODEL}`);
  console.table(rows);
});
