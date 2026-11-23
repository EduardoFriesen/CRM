"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Result } from "@/lib/result";
import type { ConnectionView } from "@/whatsapp/connect";
import { connectWhatsApp } from "./actions";

const POLL_MS = 3000;

export function WhatsAppPanel({ slug }: { slug: string }) {
  const [state, setState] = useState<Result<ConnectionView> | null>(null);

  const refresh = useCallback(async () => setState(await connectWhatsApp(slug)), [slug]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const next = await connectWhatsApp(slug);
      if (!active) return;
      setState(next);
      if (next.success && next.data.status !== "open") timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [slug]);

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
        <button type="button" onClick={() => void refresh()}>
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
