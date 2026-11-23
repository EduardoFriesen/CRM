import { WEBHOOK_SECRET_HEADER } from "@/whatsapp/secret";
import { handleEvolutionEvent } from "@/whatsapp/webhook";

// Internal only: Evolution calls http://crm:3000 directly; nginx returns 404 for this path.
// Never log the body: it carries customer messages, phone numbers and the instance apikey.
export async function POST(req: Request, ctx: { params: Promise<{ instance: string }> }) {
  const { instance } = await ctx.params;
  const body: unknown = await req.json().catch(() => null);
  const { status } = await handleEvolutionEvent(instance, req.headers.get(WEBHOOK_SECRET_HEADER), body);
  if (status === 200) return Response.json({ success: true, data: null });
  const error =
    status === 401
      ? { code: "UNAUTHORIZED", message: "Invalid webhook credentials" }
      : { code: "BAD_REQUEST", message: "Invalid payload" };
  return Response.json({ success: false, error }, { status });
}
