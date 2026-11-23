"use server";

import { revalidatePath } from "next/cache";
import { createProduct, deleteProduct, setProductActive, updateProduct } from "@/catalog/catalog";
import type { Product } from "@/db/schema";
import type { Result } from "@/lib/result";
import { getCurrentTenant } from "@/tenants/tenants";

export type ProductFormValues = { name: string; description: string; price: string; stock: string; active: boolean; loadedStock: string };
// Submitted values travel back so a failed submit doesn't wipe the form.
export type ProductFormState = { result: Result<Product>; values: ProductFormValues; nonce: number } | null;

export async function saveProductAction(slug: string, _prev: ProductFormState, form: FormData): Promise<ProductFormState> {
  const tenant = await getCurrentTenant(slug);
  const values: ProductFormValues = {
    name: String(form.get("name") ?? ""),
    description: String(form.get("description") ?? ""),
    price: String(form.get("price") ?? ""),
    stock: String(form.get("stock") ?? ""),
    active: form.get("active") === "on",
    loadedStock: String(form.get("loadedStock") ?? ""),
  };
  const id = String(form.get("id") ?? "");
  const result = id
    ? await updateProduct(tenant.id, id, values)
    : await createProduct(tenant.id, { ...values, loadedStock: undefined });
  if (result.success) revalidatePath(`/t/${tenant.slug}/catalogo`);
  // After a stock conflict the next save must compare against the stock that is there now.
  if (!result.success && result.error.code === "CONFLICT") {
    const current = (result.error.details as { currentStock: number | null }).currentStock;
    values.loadedStock = current === null ? "" : String(current);
  }
  return { result, values, nonce: Date.now() };
}

export async function toggleProductAction(slug: string, id: string, active: boolean): Promise<Result<Product>> {
  const tenant = await getCurrentTenant(slug);
  const result = await setProductActive(tenant.id, id, active);
  if (result.success) revalidatePath(`/t/${tenant.slug}/catalogo`);
  return result;
}

export async function deleteProductAction(slug: string, id: string): Promise<Result<{ id: string }>> {
  const tenant = await getCurrentTenant(slug);
  const result = await deleteProduct(tenant.id, id);
  if (result.success) revalidatePath(`/t/${tenant.slug}/catalogo`);
  return result;
}
