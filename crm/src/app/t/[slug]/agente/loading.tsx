export default function AgentLoading() {
  return (
    <main className="page" aria-busy="true">
      <p className="visually-hidden" role="status">
        Cargando agente…
      </p>
      <div className="skeleton skeleton-head" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card" />
    </main>
  );
}
