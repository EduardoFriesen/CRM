"use client";

import { useActionState, useState, useTransition } from "react";
import type { Product } from "@/db/schema";
import { formatPrice } from "@/lib/money";
import { deleteProductAction, saveProductAction, toggleProductAction, type ProductFormState } from "./actions";

type Field = "name" | "description" | "price" | "stock";
type FieldErrors = Partial<Record<Field, string[]>>;

const toValues = (p: Product) => ({
  name: p.name,
  description: p.description,
  price: String(Number(p.price)).replace(".", ","),
  stock: p.stock === null ? "" : String(p.stock),
  active: p.active,
  loadedStock: p.stock === null ? "" : String(p.stock),
});

export function CatalogManager({ slug, products }: { slug: string; products: Product[] }) {
  const [editing, setEditing] = useState<Product | null>(null);
  const [state, action, saving] = useActionState<ProductFormState, FormData>(
    async (prev, form) => {
      const next = await saveProductAction(slug, prev, form);
      if (next?.result.success) setEditing(null);
      return next;
    },
    null,
  );
  const result = state?.result;
  const errors: FieldErrors = result && !result.success ? ((result.error.details as FieldErrors) ?? {}) : {};
  const failed = result && !result.success;
  const values = failed ? state.values : editing ? toValues(editing) : undefined;
  // Remount the form when switching product or after a save so defaults refresh.
  const formKey = editing ? `edit-${editing.id}` : `new-${failed ? "kept" : (state?.nonce ?? 0)}`;

  return (
    <div className="catalog">
      <section aria-labelledby="product-form-title" className="panel">
        <h2 id="product-form-title">{editing ? `Editar ${editing.name}` : "Nuevo producto"}</h2>
        <form key={formKey} action={action} className="product-form" noValidate>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          {editing && <input type="hidden" name="loadedStock" value={values?.loadedStock ?? ""} />}
          <Field name="name" label="Nombre" errors={errors} defaultValue={values?.name} required />
          <Field name="price" label="Precio" errors={errors} defaultValue={values?.price} hint="En pesos. Ej. 2.500 o 2.500,50" inputMode="decimal" required />
          <Field name="stock" label="Stock" errors={errors} defaultValue={values?.stock} hint="Vacío = no controlar stock. El bot nunca dice la cantidad." inputMode="numeric" />
          <Field name="description" label="Descripción" errors={errors} defaultValue={values?.description} hint="Lo que el bot puede contar del producto" multiline />
          <label className="check">
            <input type="checkbox" name="active" defaultChecked={values?.active ?? true} /> Activo (el bot lo ofrece)
          </label>
          <div className="form-actions">
            <button type="submit" disabled={saving}>
              {saving ? "Guardando…" : editing ? "Guardar cambios" : "Agregar producto"}
            </button>
            {editing && (
              <button type="button" className="secondary" onClick={() => setEditing(null)}>
                Cancelar
              </button>
            )}
          </div>
          <p role="status" className={failed ? "form-error" : "form-ok"}>
            {result ? (result.success ? `Guardado: ${result.data.name}` : result.error.message) : ""}
          </p>
        </form>
      </section>

      <section aria-labelledby="product-list-title">
        <h2 id="product-list-title">Productos ({products.length})</h2>
        {products.length === 0 ? (
          <p className="empty-note">Todavía no cargaste productos. El bot solo puede ofrecer lo que esté acá.</p>
        ) : (
          <div className="table-wrap">
            <table className="catalog-table">
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col" className="num">Precio</th>
                  <th scope="col" className="num">Stock</th>
                  <th scope="col">Estado</th>
                  <th scope="col">
                    <span className="visually-hidden">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <ProductRow key={p.id} slug={slug} product={p} onEdit={() => setEditing(p)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Field(props: {
  name: Field;
  label: string;
  errors: FieldErrors;
  defaultValue?: string;
  hint?: string;
  required?: boolean;
  multiline?: boolean;
  inputMode?: "decimal" | "numeric";
}) {
  const error = props.errors[props.name]?.[0];
  const hintId = `${props.name}-hint`;
  const common = {
    id: props.name,
    name: props.name,
    defaultValue: props.defaultValue,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": hintId,
  };
  return (
    <div className={`field field-${props.name}`}>
      <label htmlFor={props.name}>{props.label}</label>
      {props.multiline ? (
        <textarea {...common} rows={2} />
      ) : (
        <input {...common} inputMode={props.inputMode} required={props.required} autoComplete="off" />
      )}
      <small id={hintId} className={error ? "error" : undefined}>
        {error ?? props.hint ?? ""}
      </small>
    </div>
  );
}

function ProductRow({ slug, product: p, onEdit }: { slug: string; product: Product; onEdit: () => void }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ success: boolean; error?: { message: string } }>) =>
    start(async () => {
      setError(null);
      try {
        const r = await fn();
        if (!r.success) setError(r.error?.message ?? "No pudimos guardar el cambio");
      } catch {
        setError("No pudimos guardar el cambio, probá de nuevo.");
      }
    });

  return (
    <tr aria-busy={pending || undefined} className={p.active ? undefined : "paused"}>
      <td>
        <span className="product-name">{p.name}</span>
        {p.description && <span className="product-desc">{p.description}</span>}
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
      </td>
      <td className="num">{formatPrice(p.price)}</td>
      <td className="num">{p.stock === null ? "—" : p.stock === 0 ? "Sin stock" : p.stock}</td>
      <td>{p.active ? "Activo" : "Pausado"}</td>
      <td>
        <div className="row-actions">
        {confirming ? (
          <>
            <button type="button" className="danger" disabled={pending} onClick={() => run(() => deleteProductAction(slug, p.id))}>
              Confirmar borrado
            </button>
            <button type="button" className="secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button type="button" className="secondary" onClick={onEdit}>
              Editar
            </button>
            <button type="button" className="secondary" disabled={pending} onClick={() => run(() => toggleProductAction(slug, p.id, !p.active))}>
              {p.active ? "Pausar" : "Activar"}
            </button>
            <button type="button" className="secondary" onClick={() => setConfirming(true)}>
              Borrar
            </button>
          </>
        )}
        </div>
      </td>
    </tr>
  );
}
