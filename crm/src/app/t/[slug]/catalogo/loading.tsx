export default function CatalogLoading() {
  return (
    <main className="page" aria-busy="true">
      <p className="visually-hidden" role="status">
        Cargando catálogo…
      </p>
      <div className="skeleton skeleton-head" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card" />
    </main>
  );
}
