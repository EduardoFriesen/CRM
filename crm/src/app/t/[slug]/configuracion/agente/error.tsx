"use client";

export default function AgentError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page">
      <div className="empty-board" role="alert">
        <h1>No pudimos cargar el agente</h1>
        <p>Probá de nuevo en unos segundos.</p>
        <button type="button" onClick={reset}>
          Reintentar
        </button>
      </div>
    </main>
  );
}
