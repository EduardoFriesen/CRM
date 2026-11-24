"use client";

export default function BusinessError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page">
      <div className="empty-board" role="alert">
        <h1>No pudimos cargar la información del negocio</h1>
        <p>Probá de nuevo en unos segundos.</p>
        <button type="button" onClick={reset}>
          Reintentar
        </button>
      </div>
    </main>
  );
}
