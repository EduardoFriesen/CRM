"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { TryTurn } from "@/bot/try-agent";
import type { Stage } from "@/db/schema";
import { STAGE_LABELS } from "../stages";
import { tryAgentAction } from "./actions";

type Turn = TryTurn & { stage?: Stage | null };

export function TestChat({ slug, configured }: { slug: string; configured: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    // Keep the last 19 turns so the request stays within the 20-message limit.
    const history = [...turns, { role: "user" as const, text }].slice(-20);
    setTurns(history);
    setDraft("");
    setError(null);
    start(async () => {
      try {
        const r = await tryAgentAction(slug, history.map(({ role, text: t }) => ({ role, text: t })));
        if (r.success) setTurns([...history, { role: "assistant" as const, text: r.data.reply, stage: r.data.stage }].slice(-19));
        else setError(r.error.message);
      } catch {
        setError("No pudimos hablar con el agente, probá de nuevo.");
      }
    });
  };

  return (
    <aside className="panel test-chat" aria-labelledby="test-chat-title">
      <div className="test-chat-head">
        <h2 id="test-chat-title">Chat de prueba</h2>
        {turns.length > 0 && (
          <button type="button" className="secondary" onClick={() => setTurns([])}>
            Reiniciar
          </button>
        )}
      </div>
      <p className="meta-note">Usa la configuración guardada. No manda nada por WhatsApp ni mueve tarjetas.</p>
      <ol className="chat-log" aria-live="polite">
        {turns.length === 0 && <li className="chat-empty">Probá cómo responde tu agente. Escribí como lo haría un cliente.</li>}
        {turns.map((t, i) => (
          <li key={i} className={`bubble ${t.role}`}>
            <span className="visually-hidden">{t.role === "user" ? "Vos: " : "Agente: "}</span>
            {t.text}
            {t.stage && <span className="stage-note">(el bot movería la tarjeta a {STAGE_LABELS[t.stage]})</span>}
          </li>
        ))}
        {pending && <li className="bubble assistant typing">Escribiendo…</li>}
      </ol>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <form className="chat-input" onSubmit={send}>
        <label htmlFor="test-message" className="visually-hidden">
          Mensaje de prueba
        </label>
        <input
          id="test-message"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          maxLength={1000}
          placeholder={configured ? "Ej. ¿Tienen medialunas?" : "Guardá el agente primero"}
          disabled={!configured}
          autoComplete="off"
        />
        <button type="submit" disabled={!configured || pending || !draft.trim()}>
          Enviar
        </button>
      </form>
    </aside>
  );
}
