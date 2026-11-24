import { getBusinessProfile } from "@/business/profile";
import { getCurrentTenant } from "@/tenants/tenants";
import { BusinessForm } from "./business-form";

export const dynamic = "force-dynamic";

export default async function BusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const tenant = await getCurrentTenant((await params).slug);
  const profile = await getBusinessProfile(tenant.id);
  return (
    <main className="page">
      <div className="page-head">
        <h1>Negocio</h1>
        <p className="meta">El bot responde horarios, dirección, pagos y envíos con lo que cargues acá. Si un campo queda vacío, consulta al admin.</p>
      </div>
      <BusinessForm slug={tenant.slug} profile={profile} />
    </main>
  );
}
