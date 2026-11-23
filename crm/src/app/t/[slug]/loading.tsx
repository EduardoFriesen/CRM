import { STAGES } from "@/db/schema";

export default function BoardLoading() {
  return (
    <main className="page" aria-busy="true">
      <p className="visually-hidden" role="status">
        Cargando clientes…
      </p>
      <div className="skeleton skeleton-head" />
      <div className="board">
        {STAGES.map((s) => (
          <div key={s} className="column">
            <div className="skeleton skeleton-head" />
            <div className="skeleton skeleton-card" />
            <div className="skeleton skeleton-card" />
          </div>
        ))}
      </div>
    </main>
  );
}
