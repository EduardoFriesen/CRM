import { redirect } from "next/navigation";

export default async function SettingsRedirect({ params }: { params: Promise<{ slug: string }> }) {
  redirect(`/t/${(await params).slug}/configuracion/agente`);
}
