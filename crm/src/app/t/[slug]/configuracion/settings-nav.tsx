"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SettingsNav({ slug }: { slug: string }) {
  const path = usePathname();
  const base = `/t/${slug}/configuracion`;
  const links = [
    { href: `${base}/agente`, label: "Agente" },
    { href: `${base}/tablero`, label: "Tablero" },
    { href: `${base}/negocio`, label: "Negocio" },
  ];
  return (
    <nav className="settings-nav" aria-label="Secciones de configuración">
      {links.map((l) => (
        <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
