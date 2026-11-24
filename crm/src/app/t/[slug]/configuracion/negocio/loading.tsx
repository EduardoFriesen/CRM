export default function BusinessLoading() {
  return (
    <main className="page" aria-busy="true">
      <p className="visually-hidden" role="status">
        Cargando información del negocio…
      </p>
      <div className="skeleton skeleton-head" />
      <div className="skeleton skeleton-card" />
    </main>
  );
}
