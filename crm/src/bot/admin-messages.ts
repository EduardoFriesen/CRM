import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { tenants, whatsappInstances } from "@/db/schema";
import { sendText } from "@/whatsapp/evolution";

type Who = { name: string | null; phone: string | null };

const who = (c: Who) => `${c.name || "un cliente"}${c.phone ? ` (+${c.phone})` : ""}`;
const sentence = (s: string) => {
  const t = s.trim();
  return /[.?!]$/.test(t) ? t : `${t}.`;
};

export const HINT_TEXT = "Para responder una consulta, citá el mensaje de la consulta.";
export const NO_MATCH_TEXT = "Esa consulta ya fue respondida o no la encuentro.";

export const escalationText = (c: Who, question: string) =>
  `Consulta de ${who(c)}: ${sentence(question)} Respondé citando este mensaje.`;

export const reminderText = (c: Who, question: string) => `Recordatorio: ${escalationText(c, question)}`;

export const handoffText = (c: Who, reason: string) =>
  `Traspaso: ${who(c)} quiere cerrar una compra. ${sentence(reason)} Atendelo desde el WhatsApp del negocio.`;

export const attentionText = (c: Who, reason: string) =>
  `⚠️ ${who(c)} necesita atención: ${sentence(reason)} Atendelo desde el WhatsApp del negocio.`;

export type NotLearned = "price" | "personal" | null;
const NOT_LEARNED_NOTE: Record<Exclude<NotLearned, null>, string> = {
  price: " (no la guardé porque es de precios)",
  personal: " (no la guardé porque es sobre este cliente)",
};

export const relayConfirmText = (name: string | null, notLearned: NotLearned) =>
  `Listo, le respondí a ${name || "un cliente"}.${notLearned ? NOT_LEARNED_NOTE[notLearned] : ""}`;

export const relayFailedText = (name: string | null) =>
  `No le pude mandar la respuesta a ${name || "un cliente"}: el bot está pausado o apagado en esa charla. Respondele vos desde el WhatsApp del negocio.`;

// Sends to the admin's personal WhatsApp through the tenant's own instance.
export async function notifyAdmin(
  tenantId: string,
  text: string,
  deps: { send?: typeof sendText } = {},
): Promise<{ id: string }> {
  const { adminPhone, instance } = await withTenant(tenantId, async (tx) => {
    const [t] = await tx.select({ adminPhone: tenants.adminPhone }).from(tenants).where(eq(tenants.id, tenantId));
    const [i] = await tx.select({ name: whatsappInstances.name }).from(whatsappInstances);
    return { adminPhone: t?.adminPhone, instance: i?.name };
  });
  if (!adminPhone || !instance) throw Object.assign(new Error("No admin phone or instance"), { code: "NO_ADMIN_CHANNEL" });
  return (deps.send ?? sendText)(instance, `${adminPhone}@s.whatsapp.net`, text);
}
