"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Result } from "@/lib/result";
import type { ConnectionView } from "@/whatsapp/connect";
import { connectWhatsApp } from "./actions";

const POLL_MS = 3000;
const UNREACHABLE: Result<ConnectionView> = {
  success: false,
  error: { code: "NETWORK", message: "No pudimos hablar con WhatsApp, reintentá en unos segundos." },
};

// A rejected server action (network blip, server restart) becomes an error state, not a frozen panel.
async function load(slug: string): Promise<Result<ConnectionView>> {
  try {
    return await connectWhatsApp(slug);
  } catch {
    return UNREACHABLE;
  }
}

export function WhatsAppPanel({ slug }: { slug: string }) {
  const [state, setState] = useState<Result<ConnectionView> | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = () => {
    setState(null);
    setAttempt((n) => n + 1);
  };

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const next = await load(slug);
      if (!active) return;
      setState(next);
      if (next.success && next.data.status !== "open") timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [slug, attempt]);

  if (!state) {
    return (
      <div className="wa-panel" aria-busy="true">
        <div className="skeleton qr-skeleton" />
        <p role="status">Preparando la conexión…</p>
      </div>
    );
  }

  if (!state.success) {
    return (
      <div className="wa-panel" role="alert">
        <p>{state.error.message}</p>
        <button type="button" onClick={retry}>
          Reintentar
        </button>
      </div>
    );
  }

  if (state.data.status === "open") {
    return (
      <div className="wa-panel">
        <p role="status">WhatsApp conectado. Los mensajes nuevos aparecen en el tablero.</p>
        <Link href={`/t/${slug}`}>Ir a Clientes</Link>
      </div>
    );
  }

  return (
    <div className="wa-panel">
      <ol>
        <li>Abrí WhatsApp en el teléfono del negocio.</li>
        <li>Entrá a Dispositivos vinculados y tocá Vincular un dispositivo.</li>
        <li>Escaneá este código. Se actualiza solo.</li>
      </ol>
      {state.data.qrBase64 ? (
        // eslint-disable-next-line @next/next/no-img-element -- data: URI from Evolution, not optimizable
        <img src={state.data.qrBase64} alt="Código QR para vincular WhatsApp" width={264} height={264} />
      ) : (
        <div className="skeleton qr-skeleton" aria-label="Generando código QR" />
      )}
      <p role="status">Esperando que escanees el código…</p>
    </div>
  );
}
