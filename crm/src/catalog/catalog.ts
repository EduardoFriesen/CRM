import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { products, type Product } from "@/db/schema";
import { formatPrice } from "@/lib/money";
import { fail, ok, type Result } from "@/lib/result";

const optionalStock = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.union([z.null(), z.coerce.number().int("Tiene que ser un número entero").min(0, "Tiene que ser mayor o igual a 0")]),
);
const activeFlag = z.preprocess((v) => (v === undefined ? true : v === true || v === "true" || v === "on"), z.boolean());

const AR_GROUPED = /^\d{1,3}(\.\d{3})+$/;
const AR_GROUPED_DECIMAL = /^\d{1,3}(\.\d{3})+,\d+$/;

// es-AR input: "." groups thousands and "," is the decimal mark ("2.500" = 2500,
// "2.500,50" = 2500.5). A bare "12.5" or "2500.50" is still read as a decimal.
// Mixed forms that don't fit ("2,500.50") become NaN and fail validation.
function normalizePrice(raw: string): string {
  const v = raw.trim();
  if (v.includes(",")) {
    if (v.includes(".") && !AR_GROUPED_DECIMAL.test(v)) return "NaN";
    return v.replace(/\./g, "").replace(",", ".");
  }
  return AR_GROUPED.test(v) ? v.replace(/\./g, "") : v;
}

export const productInput = z.object({
  name: z.string().trim().min(1, "Poné un nombre").max(120, "Máximo 120 caracteres"),
  description: z.string().trim().max(1000, "Máximo 1000 caracteres").default(""),
  price: z.preprocess(
    (v) => (typeof v === "string" ? normalizePrice(v) : v),
    z.coerce
      .number({ error: "Tiene que ser un número" })
      .min(0, "Tiene que ser mayor o igual a 0")
      .max(9_999_999_999.99, "Demasiado alto"),
  ),
  stock: optionalStock,
  active: activeFlag,
  // The stock the edit form was loaded with. Orders change stock concurrently, so an edit
  // only writes stock when the user changed it, and only if it still holds this value.
  loadedStock: z.preprocess(
    (v) => (v === undefined ? undefined : v === "" || v === null ? null : v),
    z.union([z.undefined(), z.null(), z.coerce.number().int().min(0)]),
  ),
});

const productId = z.uuid();

function parse(input: unknown) {
  const parsed = productInput.safeParse(input);
  if (!parsed.success) {
    return { error: fail<Product>("VALIDATION", "Revisá los datos del producto", z.flattenError(parsed.error).fieldErrors) };
  }
  const { price, loadedStock, ...rest } = parsed.data;
  return { values: { ...rest, price: price.toFixed(2) }, loadedStock };
}

export function listProducts(tenantId: string): Promise<Product[]> {
  return withTenant(tenantId, (tx) => tx.select().from(products).orderBy(asc(products.name)));
}

export async function createProduct(tenantId: string, input: unknown): Promise<Result<Product>> {
  const p = parse(input);
  if (p.error) return p.error;
  const [row] = await withTenant(tenantId, (tx) =>
    tx.insert(products).values({ tenantId, ...p.values }).returning(),
  );
  return ok(row);
}

export async function updateProduct(tenantId: string, id: string, input: unknown): Promise<Result<Product>> {
  if (!productId.safeParse(id).success) return fail("NOT_FOUND", "No encontramos ese producto");
  const p = parse(input);
  if (p.error) return p.error;
  const { stock, ...others } = p.values;
  const loaded = p.loadedStock;
  const stockChanged = loaded === undefined || stock !== loaded;
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .update(products)
      .set({ ...others, ...(stockChanged ? { stock } : {}), updatedAt: sql`now()` })
      .where(
        and(
          eq(products.id, id),
          eq(products.tenantId, tenantId),
          stockChanged && loaded !== undefined ? sql`${products.stock} is not distinct from ${loaded}` : undefined,
        ),
      )
      .returning();
    if (row) return ok(row);
    const [current] = await tx.select({ stock: products.stock }).from(products).where(eq(products.id, id));
    if (!current) return fail<Product>("NOT_FOUND", "No encontramos ese producto");
    return fail<Product>(
      "CONFLICT",
      `El stock cambió mientras editabas (ahora ${current.stock ?? "sin control"}). Revisalo y guardá de nuevo.`,
      { currentStock: current.stock },
    );
  });
}

export async function setProductActive(tenantId: string, id: string, active: boolean): Promise<Result<Product>> {
  if (!productId.safeParse(id).success) return fail("NOT_FOUND", "No encontramos ese producto");
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .update(products)
      .set({ active, updatedAt: sql`now()` })
      .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
      .returning(),
  );
  return row ? ok(row) : fail("NOT_FOUND", "No encontramos ese producto");
}

export async function deleteProduct(tenantId: string, id: string): Promise<Result<{ id: string }>> {
  if (!productId.safeParse(id).success) return fail("NOT_FOUND", "No encontramos ese producto");
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .delete(products)
      .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
      .returning({ id: products.id }),
  );
  return row ? ok(row) : fail("NOT_FOUND", "No encontramos ese producto");
}

export type CatalogHit = { name: string; description: string; price: string; availability: "disponible" | "sin stock" };

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

// What the bot may say about a product: never the stock quantity.
// ponytail: filters active products in memory; fine up to a few hundred products per
// tenant. Move to unaccent + trigram index if catalogs grow.
export async function searchCatalog(tenantId: string, query: string, limit = 10): Promise<CatalogHit[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(products).where(eq(products.active, true)).orderBy(asc(products.name)),
  );
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return rows
    .filter((p) => {
      const text = normalize(`${p.name} ${p.description}`);
      return words.every((w) => text.includes(w));
    })
    .slice(0, limit)
    .map((p) => ({
      name: p.name,
      description: p.description,
      price: formatPrice(p.price),
      availability: p.stock === 0 ? "sin stock" : "disponible",
    }));
}
