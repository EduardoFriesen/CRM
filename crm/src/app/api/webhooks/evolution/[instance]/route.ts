import { WEBHOOK_SECRET_HEADER } from "@/whatsapp/secret";
import { handleEvolutionEvent } from "@/whatsapp/webhook";

// Internal only: Evolution calls http://crm:3000 directly; nginx returns 404 for this path.
// Never log the body or error messages: they can carry customer messages, phone numbers
// (Postgres error details include row values) and the instance apikey.
export async function POST(req: Request, ctx: { params: Promise<{ instance: string }> }) {
  const { instance } = await ctx.params;
  const body: unknown = await req.json().catch(() => null);
  try {
    const { status } = await handleEvolutionEvent(instance, req.headers.get(WEBHOOK_SECRET_HEADER), body);
    if (status === 200) return Response.json({ success: true, data: null });
    const error =
      status === 401
        ? { code: "UNAUTHORIZED", message: "Invalid webhook credentials" }
        : { code: "BAD_REQUEST", message: "Invalid payload" };
    return Response.json({ success: false, error }, { status });
  } catch (e) {
    console.error(`evolution webhook failed: ${errorCode(e)}`);
    return Response.json({ success: false, error: { code: "INTERNAL", message: "Internal error" } }, { status: 500 });
  }
}

function errorCode(e: unknown): string {
  const err = e as { code?: unknown; name?: unknown; cause?: { code?: unknown } } | null;
  return String(err?.cause?.code ?? err?.code ?? err?.name ?? "unknown");
}
