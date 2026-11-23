import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentTenant } from "@/tenants/tenants";
import { TenantNav } from "./tenant-nav";

export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const tenant = await getCurrentTenant((await params).slug);
  return (
    <>
      <header className="tenant-header">
        <Link href="/" className="back">
          ← Negocios
        </Link>
        <p className="tenant-name">{tenant.name}</p>
        <TenantNav slug={tenant.slug} />
      </header>
      {children}
    </>
  );
}
