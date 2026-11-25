export type TemplateKey =
  | "price_one"
  | "price_many"
  | "price_more"
  | "stock"
  | "hours"
  | "location"
  | "payment_methods"
  | "shipping"
  | "handoff"
  | "unclear"
  | "intro";

// Customer-facing copy: rioplatense, short, WhatsApp style. Never stock quantities.
export const TEMPLATES: Record<TemplateKey, string[]> = {
  price_one: ["{name} sale {price}.", "El {name} está {price}.", "{name}: {price}. ¿Querés que te lo reserve?"],
  price_many: ["Mirá lo que tenemos:\n{list}", "Tenemos estas opciones:\n{list}"],
  price_more: ["Hay más opciones, decime cuál te interesa y te cuento.", "Tenemos más opciones; si me decís cuál buscás, te paso el detalle."],
  stock: ["Sí, {name} está {status}.", "Por ahora {name} está {status}."],
  hours: ["Atendemos {hours}.", "Nuestro horario es {hours}."],
  location: ["Estamos en {address}.", "Nos encontrás en {address}. ¡Te esperamos!"],
  payment_methods: ["Aceptamos {payment_methods}.", "Podés pagar con {payment_methods}."],
  shipping: ["Sobre los envíos: {shipping}", "Te cuento cómo hacemos los envíos: {shipping}"],
  handoff: ["Genial, ya te paso con alguien del equipo para cerrarlo.", "Perfecto, te derivo con una persona del equipo para avanzar."],
  unclear: ["Perdón, no te entendí bien. ¿Me contás un poco más qué buscás?", "Uh, no te pesqué bien. ¿Me lo explicás de otra forma?"],
  intro: ["¡Hola! Soy el asistente de {tenant}. ¿En qué te puedo ayudar?", "¡Buenas! Te escribe el asistente de {tenant}. Contame, ¿qué necesitás?"],
};

/** Picks a variant and fills `{var}` placeholders in one pass; throws if a variable is missing. */
export function fill(key: TemplateKey, vars: Record<string, string>, pick: () => number = Math.random): string {
  const variants = TEMPLATES[key];
  const template = variants[Math.min(Math.floor(pick() * variants.length), variants.length - 1)];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    if (!(name in vars)) throw new Error(`Template "${key}" is missing variable "${name}"`);
    return vars[name];
  });
}
