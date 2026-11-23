"use client";

import { useState, useTransition } from "react";
import { cancelOrderAction, deliverOrderAction } from "./actions";

export function OrderActions({ slug, orderId, contactName }: { slug: string; orderId: string; contactName: string }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ success: boolean; error?: { message: string } }>) =>
    start(async () => {
      setError(null);
      try {
        const r = await fn();
        if (!r.success) setError(r.error?.message ?? "No pudimos actualizar el pedido");
      } catch {
        setError("No pudimos actualizar el pedido, probá de nuevo.");
      }
    });

  return (
    <div className="row-actions">
      {confirming ? (
        <>
          <button type="button" className="danger" disabled={pending} onClick={() => run(() => cancelOrderAction(slug, orderId))}>
            Confirmar cancelación
          </button>
          <button type="button" className="secondary" onClick={() => setConfirming(false)}>
            Volver
          </button>
        </>
      ) : (
        <>
          <button type="button" disabled={pending} onClick={() => run(() => deliverOrderAction(slug, orderId))} aria-label={`Marcar entregado el pedido de ${contactName}`}>
            Marcar entregado
          </button>
          <button type="button" className="secondary" onClick={() => setConfirming(true)} aria-label={`Cancelar el pedido de ${contactName}`}>
            Cancelar
          </button>
        </>
      )}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
