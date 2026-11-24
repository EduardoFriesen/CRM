export default function SettingsLoading() {
  return (
    <main className="page" aria-busy="true">
      <p className="visually-hidden" role="status">
        Cargando configuración…
      </p>
      <div className="skeleton skeleton-head" />
      <div className="skeleton skeleton-card" />
    </main>
  );
}
