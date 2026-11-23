import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentTenant } from "@/tenants/tenants";

export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const tenant = await getCurrentTenant((await params).slug);
  return (
    <div className="tenant-shell">
      <header className="tenant-header">
        <Link href="/" className="back">
          Negocios
        </Link>
        <p className="tenant-name">{tenant.name}</p>
        <nav aria-label="Secciones del negocio">
          <Link href={`/t/${tenant.slug}`}>Clientes</Link>
          <Link href={`/t/${tenant.slug}/whatsapp`}>WhatsApp</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
