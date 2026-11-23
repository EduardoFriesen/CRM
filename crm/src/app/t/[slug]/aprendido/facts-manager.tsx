"use client";

import { useState, useTransition } from "react";
import type { BusinessFact } from "@/db/schema";
import { deleteFactAction, updateFactAction } from "./actions";

export function FactsManager({ slug, facts }: { slug: string; facts: BusinessFact[] }) {
  if (facts.length === 0) {
    return (
      <p className="empty-note">
        Todavía no aprendió nada. Cuando el bot te consulte algo por WhatsApp y respondas citando el mensaje, la respuesta
        queda acá y el bot la usa la próxima vez. Los precios nunca se guardan.
      </p>
    );
  }
  return (
    <ul className="facts">
      {facts.map((f) => (
        <FactItem key={f.id} slug={slug} fact={f} />
      ))}
    </ul>
  );
}

function FactItem({ slug, fact }: { slug: string; fact: BusinessFact }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [question, setQuestion] = useState(fact.question);
  const [answer, setAnswer] = useState(fact.answer);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ success: boolean; error?: { message: string } }>, after?: () => void) =>
    start(async () => {
      setError(null);
      try {
        const r = await fn();
        if (r.success) after?.();
        else setError(r.error?.message ?? "No pudimos guardar el cambio");
      } catch {
        setError("No pudimos guardar el cambio, probá de nuevo.");
      }
    });

  return (
    <li className="fact panel" aria-busy={pending || undefined}>
      {editing ? (
        <form
          className="fact-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateFactAction(slug, fact.id, question, answer), () => setEditing(false));
          }}
        >
          <div className="field">
            <label htmlFor={`q-${fact.id}`}>Pregunta</label>
            <input id={`q-${fact.id}`} value={question} onChange={(e) => setQuestion(e.currentTarget.value)} maxLength={500} />
          </div>
          <div className="field">
            <label htmlFor={`a-${fact.id}`}>Respuesta</label>
            <textarea id={`a-${fact.id}`} value={answer} onChange={(e) => setAnswer(e.currentTarget.value)} rows={2} maxLength={2000} />
          </div>
          <div className="form-actions">
            <button type="submit" disabled={pending}>
              Guardar
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="fact-q">{fact.question}</p>
          <p className="fact-a">{fact.answer}</p>
          <div className="row-actions">
            {confirming ? (
              <>
                <button type="button" className="danger" disabled={pending} onClick={() => run(() => deleteFactAction(slug, fact.id))}>
                  Confirmar borrado
                </button>
                <button type="button" className="secondary" onClick={() => setConfirming(false)}>
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <button type="button" className="secondary" onClick={() => setEditing(true)}>
                  Editar
                </button>
                <button type="button" className="secondary" onClick={() => setConfirming(true)}>
                  Borrar
                </button>
              </>
            )}
          </div>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
