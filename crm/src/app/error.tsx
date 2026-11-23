"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page">
      <h1>Algo salió mal</h1>
      <p>No pudimos cargar esta pantalla.</p>
      <button type="button" onClick={reset}>
        Reintentar
      </button>
    </main>
  );
}
