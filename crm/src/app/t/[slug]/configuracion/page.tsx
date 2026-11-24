import { getCurrentTenant } from "@/tenants/tenants";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const tenant = await getCurrentTenant((await params).slug);
  return (
    <main className="page">
      <div className="page-head">
        <h1>Configuración</h1>
        <p className="meta">Cómo se comporta el tablero de {tenant.name}.</p>
      </div>
      <SettingsForm slug={tenant.slug} consultaIdleDays={tenant.consultaIdleDays} />
    </main>
  );
}
