import { tool } from "ai";
import { z } from "zod";
import { searchCatalog } from "@/catalog/catalog";
import { setContactStage } from "@/contacts/contacts";
import { STAGES, type Stage } from "@/db/schema";

export function makeTools(
  tenantId: string,
  contactId: string,
  opts: { dryRun: boolean; onStage?: (stage: Stage) => void },
) {
  return {
    search_catalog: tool({
      description:
        "Busca productos activos del negocio por nombre o descripción. Devuelve nombre, descripción, precio y disponibilidad.",
      inputSchema: z.object({ query: z.string().max(200).describe("Palabras a buscar; vacío lista los primeros productos") }),
      execute: async ({ query }) => ({ products: await searchCatalog(tenantId, query) }),
    }),
    set_stage: tool({
      description: "Mueve al cliente a la etapa de la conversación: consulta, venta o postventa.",
      inputSchema: z.object({ stage: z.enum(STAGES) }),
      execute: async ({ stage }) => {
        opts.onStage?.(stage);
        if (opts.dryRun) return { ok: true };
        const r = await setContactStage(tenantId, contactId, stage);
        return { ok: r.success };
      },
    }),
  };
}
