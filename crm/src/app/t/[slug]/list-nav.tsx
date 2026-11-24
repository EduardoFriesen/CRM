import Link from "next/link";

type Query = Record<string, string | number | boolean | undefined>;

// Same filters, another page. false/undefined values and page 1 are left out of the URL.
export function hrefWith(base: string, query: Query, pagina = 1): string {
  const qs = new URLSearchParams();
  const all: Query = { ...query, pagina: pagina > 1 ? pagina : undefined };
  for (const [k, v] of Object.entries(all)) {
    if (v === undefined || v === false || v === "") continue;
    qs.set(k, v === true ? "si" : String(v));
  }
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

export function FilterActions({ clearHref, active }: { clearHref: string; active: boolean }) {
  return (
    <div className="filter-actions">
      <button type="submit">Filtrar</button>
      {active && <Link href={clearHref}>Limpiar filtros</Link>}
    </div>
  );
}

export function Pager({ base, query, page, hasMore }: { base: string; query: Query; page: number; hasMore: boolean }) {
  if (page === 1 && !hasMore) return null;
  return (
    <nav className="pager" aria-label="Páginas">
      {page > 1 ? <Link href={hrefWith(base, query, page - 1)}>← Anterior</Link> : <span />}
      <span className="meta">Página {page}</span>
      {hasMore ? <Link href={hrefWith(base, query, page + 1)}>Siguiente →</Link> : <span />}
    </nav>
  );
}

// Empty list: nothing yet, or nothing that matches the filters (cleared from the filter bar).
export function EmptyList({ filtered, children }: { filtered: boolean; children: React.ReactNode }) {
  return (
    <div className="empty-note" role="status">
      {filtered ? "Ningún resultado con estos filtros." : children}
    </div>
  );
}
