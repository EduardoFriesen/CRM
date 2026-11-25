import { parseArgs } from "node:util";
import { BOT_PATHS } from "../src/db/schema";
import type { BotPath } from "../src/usage/events";

export type Prices = Record<string, { input: number; output: number; cached: number }>;

/** Subset of bot_events columns the report needs (raw snake_case from SQL). */
export type EventRow = {
  path: BotPath;
  model: string | null;
  router_model: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  router_input_tokens: number;
  router_output_tokens: number;
};

export type PathStats = { share: number; avgInput: number; avgOutput: number; avgCached: number; costUsd: number };
export type Report = { total: number; byPath: Record<BotPath, PathStats>; unknownModels: string[] };

const PER_M = 1_000_000;

export function summarize(rows: EventRow[], prices: Prices): Report {
  const unknown = new Set<string>();
  const sums = Object.fromEntries(
    BOT_PATHS.map((p) => [p, { n: 0, input: 0, output: 0, cached: 0, cost: 0 }]),
  ) as Record<BotPath, { n: number; input: number; output: number; cached: number; cost: number }>;

  // Cost in USD, or 0 when the model has no price (it is then listed in unknownModels).
  const price = (model: string | null, input: number, output: number, cached: number) => {
    if (!model || input + output + cached === 0) return 0;
    const p = prices[model];
    if (!p) {
      unknown.add(model);
      return 0;
    }
    return ((input - cached) * p.input + cached * p.cached + output * p.output) / PER_M;
  };

  for (const r of rows) {
    const s = sums[r.path];
    s.n++;
    s.input += r.input_tokens;
    s.output += r.output_tokens;
    s.cached += r.cached_tokens;
    s.cost += price(r.model, r.input_tokens, r.output_tokens, r.cached_tokens);
    s.cost += price(r.router_model, r.router_input_tokens, r.router_output_tokens, 0);
  }

  const total = rows.length;
  const byPath = Object.fromEntries(
    BOT_PATHS.map((p) => {
      const s = sums[p];
      const avg = (v: number) => (s.n ? v / s.n : 0);
      return [p, { share: total ? (s.n / total) * 100 : 0, avgInput: avg(s.input), avgOutput: avg(s.output), avgCached: avg(s.cached), costUsd: s.cost }];
    }),
  ) as Record<BotPath, PathStats>;

  return { total, byPath, unknownModels: [...unknown].sort() };
}

/** Parses `--days <int>` (default 7) and `--tenant <slug>`; throws a readable Error on bad input. */
export function parseCliArgs(argv: string[]): { days: number; tenant: string | undefined } {
  const { values } = parseArgs({
    args: argv,
    options: { tenant: { type: "string" }, days: { type: "string", default: "7" } },
  });
  const days = Number(values.days);
  if (!Number.isInteger(days) || days <= 0) throw new Error("--days must be a positive integer");
  return { days, tenant: values.tenant };
}
