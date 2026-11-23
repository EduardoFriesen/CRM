"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TenantNav({ slug }: { slug: string }) {
  const path = usePathname();
  const links = [
    { href: `/t/${slug}`, label: "Clientes" },
    { href: `/t/${slug}/whatsapp`, label: "WhatsApp" },
  ];
  return (
    <nav aria-label="Secciones del negocio">
      {links.map((l) => (
        <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
