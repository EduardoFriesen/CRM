"use client";

export default function BoardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page">
      <div className="empty-board" role="alert">
        <h1>No pudimos cargar los clientes</h1>
        <p>Puede ser un problema momentáneo con la base de datos. Probá de nuevo en unos segundos.</p>
        <button type="button" onClick={reset}>
          Reintentar
        </button>
      </div>
    </main>
  );
}
