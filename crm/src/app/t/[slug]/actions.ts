"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { closeContact, setBotOff, setContactStage } from "@/contacts/contacts";
import { cancelOrder, createOrder, deliverOrder, updateOrder, type OrderView } from "@/orders/orders";
import type { Result } from "@/lib/result";
import type { Stage } from "@/db/schema";
import { getCurrentTenant } from "@/tenants/tenants";

export async function changeStage(slug: string, contactId: string, stage: string): Promise<Result<{ id: string; stage: Stage }>> {
  const tenant = await getCurrentTenant(slug);
  const result = await setContactStage(tenant.id, contactId, stage);
  if (result.success) revalidatePath(`/t/${tenant.slug}`);
  return result;
}

export async function setBotOffAction(slug: string, contactId: string, off: unknown): Promise<Result<{ id: string }>> {
  const tenant = await getCurrentTenant(slug);
  const parsed = z.boolean().safeParse(off);
  if (!parsed.success) return { success: false, error: { code: "VALIDATION", message: "Valor inválido" } };
  const result = await setBotOff(tenant.id, contactId, parsed.data);
  if (result.success) revalidatePath(`/t/${tenant.slug}`);
  return result;
}

export async function closeContactAction(slug: string, contactId: string): Promise<Result<{ id: string }>> {
  const tenant = await getCurrentTenant(slug);
  const result = await closeContact(tenant.id, contactId);
  if (result.success) revalidatePath(`/t/${tenant.slug}`);
  return result;
}

const revalidateOrders = (slug: string) => {
  revalidatePath(`/t/${slug}`);
  revalidatePath(`/t/${slug}/catalogo`);
};

export async function createOrderAction(slug: string, input: unknown): Promise<Result<OrderView>> {
  const tenant = await getCurrentTenant(slug);
  const result = await createOrder(tenant.id, input);
  if (result.success) revalidateOrders(tenant.slug);
  return result;
}

export async function updateOrderAction(slug: string, id: string, input: unknown): Promise<Result<OrderView>> {
  const tenant = await getCurrentTenant(slug);
  const result = await updateOrder(tenant.id, id, input);
  if (result.success) revalidateOrders(tenant.slug);
  return result;
}

export async function deliverOrderAction(slug: string, id: string): Promise<Result<OrderView>> {
  const tenant = await getCurrentTenant(slug);
  const result = await deliverOrder(tenant.id, id);
  if (result.success) revalidateOrders(tenant.slug);
  return result;
}

export async function cancelOrderAction(slug: string, id: string): Promise<Result<OrderView>> {
  const tenant = await getCurrentTenant(slug);
  const result = await cancelOrder(tenant.id, id);
  if (result.success) revalidateOrders(tenant.slug);
  return result;
}
