// Operator-only: aggregates bot_events into % of turns, avg tokens and estimated cost per path.
// Usage: npm run metrics -- [--tenant <slug>] [--days 7]
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { summarize, type EventRow, type Prices } from "./metrics-report";

const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error("DATABASE_OWNER_URL is required");
  process.exit(1);
}

const { values } = parseArgs({ options: { tenant: { type: "string" }, days: { type: "string", default: "7" } } });
const days = Number(values.days);
if (!Number.isFinite(days) || days <= 0) {
  console.error("--days must be a positive number");
  process.exit(1);
}

const prices: Prices = JSON.parse(readFileSync(new URL("../scripts/prices.json", import.meta.url), "utf8"));

const sql = postgres(url, { max: 1 });
try {
  const rows = await sql<EventRow[]>`
    select e.path, e.model, e.router_model, e.input_tokens, e.output_tokens, e.cached_tokens,
           e.router_input_tokens, e.router_output_tokens
    from bot_events e
    join tenants t on t.id = e.tenant_id
    where e.created_at >= now() - make_interval(days => ${days})
      ${values.tenant ? sql`and t.slug = ${values.tenant}` : sql``}`;

  const report = summarize(rows, prices);
  console.log(`Turns: ${report.total} (last ${days} days${values.tenant ? `, tenant ${values.tenant}` : ""})`);
  console.table(
    Object.fromEntries(
      Object.entries(report.byPath).map(([p, s]) => [
        p,
        {
          "% turns": +s.share.toFixed(1),
          "avg input": Math.round(s.avgInput),
          "avg output": Math.round(s.avgOutput),
          "avg cached": Math.round(s.avgCached),
          "cost USD": +s.costUsd.toFixed(4),
        },
      ]),
    ),
  );
  if (report.unknownModels.length) {
    console.log(
      `Models without a price (their cost is EXCLUDED from "cost USD"): ${report.unknownModels.join(", ")}\n` +
        `Add them to scripts/prices.json as { "<model id>": { "input": <USD per 1M>, "output": <USD per 1M>, "cached": <USD per 1M> } }`,
    );
  }
} finally {
  await sql.end();
}
