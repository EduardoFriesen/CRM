"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function TenantNav({ slug }: { slug: string }) {
  const path = usePathname();
  const router = useRouter();
  const first = useRef(true);
  // Layouts don't re-render on client navigation; refresh so the usage bar stays current.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    router.refresh();
  }, [path, router]);
  const links = [
    { href: `/t/${slug}`, label: "Tablero" },
    { href: `/t/${slug}/clientes`, label: "Clientes" },
    { href: `/t/${slug}/ventas`, label: "Ventas" },
    { href: `/t/${slug}/catalogo`, label: "Catálogo" },
    { href: `/t/${slug}/agente`, label: "Agente" },
    { href: `/t/${slug}/aprendido`, label: "Aprendido" },
    { href: `/t/${slug}/whatsapp`, label: "WhatsApp" },
    { href: `/t/${slug}/configuracion`, label: "Configuración" },
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
