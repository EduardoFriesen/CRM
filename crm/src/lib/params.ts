import { z } from "zod";

// Search params of a filtered list. Bad values drop that filter instead of failing the page.
export type Params = Record<string, string | string[] | undefined>;
export const PAGE_SIZE = 50;

export const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional()).catch(undefined);
export const pageParam = z.coerce.number().int().min(1).max(10_000).catch(1);
export const textParam = optional(z.string().trim().min(1).max(100));

// First value of each key, parsed, without the filters that were left out.
export function parseParams<T extends z.ZodObject>(schema: T, params: Params): z.infer<T> {
  const raw = Object.fromEntries(Object.keys(schema.shape).map((k) => [k, Array.isArray(params[k]) ? params[k][0] : params[k]]));
  return Object.fromEntries(Object.entries(schema.parse(raw)).filter(([, v]) => v !== undefined)) as z.infer<T>;
}
