"use client";

import { useMemo, useState } from "react";
import { FOLLOW_UP_DAYS, followUpDraft, followUpState, applicantName } from "@/lib/followup";
import type { Job } from "@/lib/types";
import { api } from "./api";

/** A ready reminder for an application without an answer: copy it or open it in the mail app, then mark it sent. */
export function FollowUp({ job, cvText, matched, onChanged }: { job: Job; cvText?: string; matched: string[]; onChanged: () => void }) {
  const [now] = useState(() => Date.now());
  const state = followUpState(job, now);
  const draft = useMemo(() => followUpDraft(job, { name: applicantName(job, cvText), matched }), [job, cvText, matched]);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  if (!state) return null;
  const text = body ?? draft.body;

  const copy = async () => {
    await navigator.clipboard.writeText(`${draft.subject}\n\n${text}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const markSent = async () => {
    try {
      await api("/api/jobs/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: job.id, kind: "follow_up", text: state.count ? `Wysłano ${state.count + 1}. przypomnienie` : "Wysłano przypomnienie o aplikacji" }),
      });
      setOpen(false);
      setBody(undefined);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const status = state.giveUp
    ? `Cisza od ${state.quietDays} dni mimo ${state.count} przypomnień – rozważ zamknięcie (Odrzucili / Wygasła) i skup się na innych ofertach.`
    : state.due
      ? `Brak odpowiedzi od ${state.quietDays} dni – czas się przypomnieć${state.count ? " (ostatni raz)" : ""}.`
      : `Bez odpowiedzi od ${state.quietDays} d. Przypomnienie warto wysłać po ${FOLLOW_UP_DAYS} dniach ciszy${state.count ? ` (wysłano już ${state.count})` : ""}.`;

  return (
    <section className={`box followup${state.due ? " due" : ""}`}>
      <div className="box-head">
        <h3>Follow-up</h3>
        {!state.giveUp && (
          <button className="btn small" style={{ marginLeft: "auto" }} onClick={() => setOpen((o) => !o)}>
            {open ? "Zwiń" : "Szkic wiadomości"}
          </button>
        )}
      </div>
      <p className="small">{status}</p>
      {open && (
        <>
          <div className="followup-subject small">
            <span className="muted">Temat:</span> {draft.subject}
          </div>
          <textarea rows={9} value={text} onChange={(e) => setBody(e.target.value)} spellCheck />
          <div className="actions-row">
            <button className="btn small" onClick={copy}>
              {copied ? "Skopiowano ✓" : "Kopiuj"}
            </button>
            <a className="btn small" href={`mailto:?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(text)}`}>
              Otwórz w poczcie
            </a>
            <button className="btn primary small" style={{ marginLeft: "auto" }} onClick={markSent}>
              Zapisz jako wysłane
            </button>
          </div>
          <p className="muted small">
            Wyślij na adres rekrutera z ogłoszenia lub z potwierdzenia aplikacji (odpowiedz na tamten wątek). Dopracowaną wersję napisze Claude: <i>„napisz follow-up do oferty {job.id}”</i>.
          </p>
          {error && <p className="error small">{error}</p>}
        </>
      )}
    </section>
  );
}
