"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { formatPrice } from "@/lib/money";
import { createOrderAction } from "./actions";

export type OrderProduct = { id: string; name: string; price: string; stock: number | null };
type Line = { productId: string; quantity: string };
type FieldErrors = Partial<Record<"items" | "deliveryDate" | "address" | "locality" | "notes", string[]>>;

const optionLabel = (p: OrderProduct) =>
  `${p.name} · ${formatPrice(p.price)} · ${p.stock === null ? "sin control de stock" : `stock ${p.stock}`}`;

export function CreateOrderButton({
  slug,
  contactId,
  contactName,
  products,
  today,
}: {
  slug: string;
  contactId: string;
  contactName: string;
  products: OrderProduct[];
  today: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: "1" }]);
  const [deliveryDate, setDeliveryDate] = useState(today);
  const [address, setAddress] = useState("");
  const [locality, setLocality] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, start] = useTransition();

  const byId = new Map(products.map((p) => [p.id, p]));
  const total = lines.reduce((sum, l) => sum + Number(byId.get(l.productId)?.price ?? 0) * (Number(l.quantity) || 0), 0);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const reset = () => {
    setLines([{ productId: "", quantity: "1" }]);
    setDeliveryDate(today);
    setAddress("");
    setLocality("");
    setNotes("");
    setError(null);
    setFieldErrors({});
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    start(async () => {
      try {
        const r = await createOrderAction(slug, {
          contactId,
          items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          deliveryDate,
          address,
          locality,
          notes,
        });
        if (r.success) {
          dialog.current?.close();
          reset();
        } else {
          setError(r.error.message);
          setFieldErrors((r.error.details as FieldErrors) ?? {});
        }
      } catch {
        setError("No pudimos guardar el pedido, probá de nuevo.");
      }
    });
  };

  return (
    <>
      <button type="button" className="secondary" onClick={() => dialog.current?.showModal()} aria-label={`Crear pedido para ${contactName}`}>
        Crear pedido
      </button>
      <dialog ref={dialog} className="order-dialog" aria-labelledby={`order-title-${contactId}`}>
        <form onSubmit={submit} className="order-form" noValidate>
          <h2 id={`order-title-${contactId}`}>Pedido de {contactName}</h2>
          {products.length === 0 ? (
            <p className="empty-note">No hay productos activos en el catálogo. Cargalos en Catálogo para armar pedidos.</p>
          ) : (
            <fieldset className="order-lines">
              <legend>Productos</legend>
              {lines.map((l, i) => (
                <div key={i} className="order-line">
                  <label htmlFor={`p-${contactId}-${i}`} className="visually-hidden">
                    Producto {i + 1}
                  </label>
                  <select id={`p-${contactId}-${i}`} value={l.productId} onChange={(e) => setLine(i, { productId: e.currentTarget.value })}>
                    <option value="">Elegí un producto</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {optionLabel(p)}
                      </option>
                    ))}
                  </select>
                  <label htmlFor={`q-${contactId}-${i}`} className="visually-hidden">
                    Cantidad {i + 1}
                  </label>
                  <input
                    id={`q-${contactId}-${i}`}
                    inputMode="numeric"
                    value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.currentTarget.value })}
                    className="qty"
                  />
                  {lines.length > 1 && (
                    <button type="button" className="secondary" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Quitar producto ${i + 1}`}>
                      Quitar
                    </button>
                  )}
                </div>
              ))}
              {lines.length < 30 && (
                <button type="button" className="secondary" onClick={() => setLines((ls) => [...ls, { productId: "", quantity: "1" }])}>
                  Agregar producto
                </button>
              )}
              {fieldErrors.items && <small className="error">{fieldErrors.items[0]}</small>}
            </fieldset>
          )}
          <div className="order-grid">
            <div className="field">
              <label htmlFor={`d-${contactId}`}>Fecha de entrega</label>
              <input id={`d-${contactId}`} type="date" min={today} value={deliveryDate} onChange={(e) => setDeliveryDate(e.currentTarget.value)} />
              {fieldErrors.deliveryDate && <small className="error">{fieldErrors.deliveryDate[0]}</small>}
            </div>
            <div className="field">
              <label htmlFor={`a-${contactId}`}>Dirección</label>
              <input id={`a-${contactId}`} value={address} maxLength={200} onChange={(e) => setAddress(e.currentTarget.value)} autoComplete="off" />
              {fieldErrors.address && <small className="error">{fieldErrors.address[0]}</small>}
            </div>
            <div className="field">
              <label htmlFor={`l-${contactId}`}>Localidad</label>
              <input id={`l-${contactId}`} value={locality} maxLength={100} onChange={(e) => setLocality(e.currentTarget.value)} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor={`n-${contactId}`}>Notas</label>
              <input id={`n-${contactId}`} value={notes} maxLength={500} onChange={(e) => setNotes(e.currentTarget.value)} autoComplete="off" />
            </div>
          </div>
          <p className="order-total">Total {formatPrice(total)}</p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" disabled={pending || products.length === 0}>
              {pending ? "Guardando…" : "Guardar pedido"}
            </button>
            <button type="button" className="secondary" onClick={() => dialog.current?.close()}>
              Cerrar
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
