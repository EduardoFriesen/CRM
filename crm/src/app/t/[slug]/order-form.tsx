"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { formatPrice } from "@/lib/money";
import type { OrderView } from "@/orders/orders";
import { createOrderAction, updateOrderAction } from "./actions";

export type OrderProduct = {
  id: string;
  name: string;
  price: string;
  stock: number | null;
};
type Line = { productId: string; quantity: string };
type FieldErrors = Partial<
  Record<"items" | "deliveryDate" | "address" | "locality" | "notes", string[]>
>;

const optionLabel = (p: OrderProduct) =>
  `${p.name} · ${formatPrice(p.price)} · ${p.stock === null ? "sin control de stock" : `stock ${p.stock}`}`;

const EMPTY_LINE: Line = { productId: "", quantity: "1" };
const linesOf = (order?: OrderView): Line[] =>
  order ? order.items.map((i) => ({ productId: i.productId ?? "", quantity: String(i.quantity) })) : [EMPTY_LINE];

// "Crear pedido", or "Editar pedido" when given a pending order (prefilled, saved over it).
export function OrderFormButton({
  slug,
  contactId,
  contactName,
  products,
  today,
  order,
}: {
  slug: string;
  contactId: string;
  contactName: string;
  products: OrderProduct[];
  today: string;
  order?: OrderView;
}) {
  // Both the customer's card and the order's card can show this form for the same contact.
  const ids = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [lines, setLines] = useState<Line[]>(() => linesOf(order));
  const [deliveryDate, setDeliveryDate] = useState(order?.deliveryDate ?? today);
  const [address, setAddress] = useState(order?.address ?? "");
  const [locality, setLocality] = useState(order?.locality ?? "");
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Out-of-stock errors are shown under the line(s) of that product, not at the top.
  const [stockError, setStockError] = useState<{
    productId: string;
    message: string;
  } | null>(null);
  const [pending, start] = useTransition();

  const byId = new Map(products.map((p) => [p.id, p]));
  const total = lines.reduce(
    (sum, l) =>
      sum +
      Number(byId.get(l.productId)?.price ?? 0) * (Number(l.quantity) || 0),
    0,
  );
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const reset = () => {
    setLines(linesOf(order));
    setDeliveryDate(order?.deliveryDate ?? today);
    setAddress(order?.address ?? "");
    setLocality(order?.locality ?? "");
    setNotes(order?.notes ?? "");
    setError(null);
    setFieldErrors({});
    setStockError(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setStockError(null);
    start(async () => {
      try {
        const fields = {
          items: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
          })),
          deliveryDate,
          address,
          locality,
          notes,
        };
        const r = order
          ? await updateOrderAction(slug, order.id, fields)
          : await createOrderAction(slug, { contactId, ...fields });
        if (r.success) {
          dialog.current?.close();
          reset();
        } else if (r.error.code === "OUT_OF_STOCK") {
          setStockError({
            productId: (r.error.details as { productId: string }).productId,
            message: r.error.message,
          });
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
      <button
        type="button"
        className="secondary"
        onClick={() => {
          // An edit starts from the order as it is now (it may have changed since the last open).
          if (order) reset();
          dialog.current?.showModal();
        }}
        aria-label={order ? `Editar pedido de ${contactName}` : `Crear pedido para ${contactName}`}
      >
        {order ? "Editar pedido" : "Crear pedido"}
      </button>
      <dialog
        ref={dialog}
        className="order-dialog"
        aria-labelledby={`order-title-${ids}`}
      >
        <form onSubmit={submit} className="order-form" noValidate>
          <h2 id={`order-title-${ids}`}>Pedido de {contactName}</h2>
          {products.length === 0 ? (
            <p className="empty-note">
              No hay productos activos en el catálogo. Cargalos en Catálogo para
              armar pedidos.
            </p>
          ) : (
            <fieldset className="order-lines">
              <legend>Productos</legend>
              {lines.map((l, i) => {
                const lineError =
                  stockError && stockError.productId === l.productId
                    ? stockError.message
                    : null;
                const errId = `e-${ids}-${i}`;
                return (
                  <div key={i} className="order-line-wrap">
                    <div className="order-line">
                      <label
                        htmlFor={`p-${ids}-${i}`}
                        className="visually-hidden"
                      >
                        Producto {i + 1}
                      </label>
                      <select
                        id={`p-${ids}-${i}`}
                        value={l.productId}
                        onChange={(e) =>
                          setLine(i, { productId: e.currentTarget.value })
                        }
                        aria-invalid={lineError ? true : undefined}
                        aria-describedby={lineError ? errId : undefined}
                      >
                        <option value="">Elegí un producto</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {optionLabel(p)}
                          </option>
                        ))}
                      </select>
                      <label
                        htmlFor={`q-${ids}-${i}`}
                        className="visually-hidden"
                      >
                        Cantidad {i + 1}
                      </label>
                      <input
                        id={`q-${ids}-${i}`}
                        inputMode="numeric"
                        value={l.quantity}
                        onChange={(e) =>
                          setLine(i, { quantity: e.currentTarget.value })
                        }
                        className="qty"
                        aria-invalid={lineError ? true : undefined}
                        aria-describedby={lineError ? errId : undefined}
                      />
                      {lines.length > 1 && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            setLines((ls) => ls.filter((_, j) => j !== i))
                          }
                          aria-label={`Quitar producto ${i + 1}`}
                        >
                          Quitar
                        </button>
                      )}
                    </div>
                    {lineError && (
                      <small id={errId} className="error" role="alert">
                        {lineError}
                      </small>
                    )}
                  </div>
                );
              })}
              {lines.length < 30 && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setLines((ls) => [...ls, { productId: "", quantity: "1" }])
                  }
                >
                  Agregar producto
                </button>
              )}
              {fieldErrors.items && (
                <small className="error">{fieldErrors.items[0]}</small>
              )}
            </fieldset>
          )}
          <div className="order-grid">
            <div className="field">
              <label htmlFor={`d-${ids}`}>Fecha de entrega</label>
              <input
                id={`d-${ids}`}
                type="date"
                min={today}
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.currentTarget.value)}
                aria-invalid={fieldErrors.deliveryDate ? true : undefined}
                aria-describedby={
                  fieldErrors.deliveryDate ? `de-${ids}` : undefined
                }
              />
              {fieldErrors.deliveryDate && (
                <small id={`de-${ids}`} className="error">
                  {fieldErrors.deliveryDate[0]}
                </small>
              )}
            </div>
            <div className="field">
              <label htmlFor={`a-${ids}`}>Dirección</label>
              <input
                id={`a-${ids}`}
                value={address}
                maxLength={200}
                onChange={(e) => setAddress(e.currentTarget.value)}
                autoComplete="off"
                aria-invalid={fieldErrors.address ? true : undefined}
                aria-describedby={
                  fieldErrors.address ? `ae-${ids}` : undefined
                }
              />
              {fieldErrors.address && (
                <small id={`ae-${ids}`} className="error">
                  {fieldErrors.address[0]}
                </small>
              )}
            </div>
            <div className="field">
              <label htmlFor={`l-${ids}`}>Localidad</label>
              <input
                id={`l-${ids}`}
                value={locality}
                maxLength={100}
                onChange={(e) => setLocality(e.currentTarget.value)}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor={`n-${ids}`}>Notas</label>
              <input
                id={`n-${ids}`}
                value={notes}
                maxLength={500}
                onChange={(e) => setNotes(e.currentTarget.value)}
                autoComplete="off"
              />
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
            <button
              type="button"
              className="secondary"
              onClick={() => dialog.current?.close()}
            >
              Cerrar
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
