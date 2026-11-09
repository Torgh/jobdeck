"use client";

import { useState } from "react";
import { ago } from "@/lib/format";
import { markdownToText } from "@/lib/markdown";
import { DOC_KINDS, DOC_LABEL, EVENT_ICON, EVENT_LABEL, type DocKind, type EventKind, type Job } from "@/lib/types";
import { api } from "./api";
import { Markdown } from "./Markdown";

const MANUAL_KINDS: Exclude<EventKind, "status">[] = ["note", "follow_up", "reply", "interview_invite", "task", "rejection", "offer"];

/** The application's story: status changes, e-mails Claude found, the user's own entries. */
export function Timeline({ job, onChanged }: { job: Job; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Exclude<EventKind, "status">>("note");
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string>();
  const events = [...(job.events ?? [])].reverse();

  const add = async () => {
    if (!text.trim()) return;
    try {
      await api("/api/jobs/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: job.id, kind, text, date: date || undefined }),
      });
      setText("");
      setDate("");
      setAdding(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section>
      <h4>
        Historia
        <button className="btn ghost small inline" onClick={() => setAdding((a) => !a)}>
          {adding ? "Anuluj" : "+ Dodaj wpis"}
        </button>
      </h4>
      {adding && (
        <div className="event-form">
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Rodzaj">
            {MANUAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {EVENT_ICON[k]} {EVENT_LABEL[k]}
              </option>
            ))}
          </select>
          <input type="text" placeholder="Co się stało? np. Telefon od rekrutera" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          {(kind === "interview_invite" || kind === "task" || kind === "offer") && (
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} title={kind === "task" ? "Termin" : "Data"} />
          )}
          <button className="btn primary small" onClick={add}>
            Zapisz
          </button>
          {error && <span className="error small">{error}</span>}
        </div>
      )}
      {events.length ? (
        <ol className="timeline">
          {events.map((e, i) => (
            <li key={i} className={`ev ${e.kind}`}>
              <span className="ev-icon">{EVENT_ICON[e.kind]}</span>
              <div>
                <div>
                  <b>{EVENT_LABEL[e.kind]}</b> <span className="muted small">· {e.at.slice(0, 10)}</span>
                  {e.by === "claude" && <span className="muted small"> · z maila</span>}
                </div>
                <div>{e.text}</div>
                {(e.from || e.subject) && (
                  <div className="muted small">
                    {e.from}
                    {e.from && e.subject && " · "}
                    {e.subject && <i>„{e.subject}”</i>}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted small">
          {job.status === "new" || job.status === "interesting"
            ? "Tu pojawi się przebieg rekrutacji."
            : "Claude uzupełni historię z odpowiedzi w Gmailu przy „co nowego w JobDeck?”."}
        </p>
      )}
    </section>
  );
}

/** Tailored CV, cover letter and interview preparation: preview, edit, PDF (print view) and DOCX. */
export function Documents({ job, onChanged }: { job: Job; onChanged: () => void }) {
  const available = DOC_KINDS.filter((k) => job.documents?.[k]);
  const interview = job.status === "interview" || job.status === "offer";
  const [tab, setTab] = useState<DocKind>(interview && job.documents?.prep ? "prep" : (available[0] ?? "cv"));
  const [editing, setEditing] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const doc = job.documents?.[tab];
  const preparing = job.status === "interesting" || job.status === "applying";

  if (!available.length) {
    return (
      <section className="box empty">
        <h3>Dokumenty</h3>
        <p className="muted small">
          {preparing ? (
            <>
              Napisz w Claude: <i>„przygotuj CV i list do oferty {job.id}”</i> – dostaniesz wersję dopasowaną do tej oferty (PDF i DOCX).
            </>
          ) : interview ? (
            <PrepHint id={job.id} />
          ) : (
            "Dopasowane CV i list motywacyjny pojawią się tutaj, gdy poprosisz o nie Claude."
          )}
        </p>
      </section>
    );
  }

  const save = async () => {
    try {
      await api("/api/docs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: job.id, doc: tab, markdown: editing }) });
      setEditing(undefined);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const copy = async () => {
    if (!doc) return;
    await navigator.clipboard.writeText(markdownToText(doc.markdown));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="box docs">
      <div className="docs-head">
        <h3>Dokumenty</h3>
        <div className="seg">
          {DOC_KINDS.map((k) => (
            <button key={k} className={tab === k ? "active" : ""} onClick={() => (setTab(k), setEditing(undefined))} disabled={!job.documents?.[k]}>
              {DOC_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      {interview && !job.documents?.prep && <PrepHint id={job.id} />}
      {doc ? (
        <>
          <div className="actions-row">
            <a className="btn small" href={`/print?id=${job.id}&doc=${tab}`} target="_blank" rel="noreferrer">
              PDF
            </a>
            <a className="btn small" href={`/api/docs?id=${job.id}&doc=${tab}&format=docx`}>
              DOCX
            </a>
            <button className="btn small" onClick={copy}>
              {copied ? "Skopiowano ✓" : "Kopiuj tekst"}
            </button>
            <button className="btn small" onClick={() => setEditing(editing === undefined ? doc.markdown : undefined)}>
              {editing === undefined ? "Edytuj" : "Anuluj"}
            </button>
            <span className="muted small" style={{ marginLeft: "auto" }}>
              zmieniony {ago(doc.updatedAt)}
            </span>
          </div>
          {editing !== undefined ? (
            <div className="doc-edit">
              <textarea rows={18} value={editing} onChange={(e) => setEditing(e.target.value)} spellCheck />
              <div className="actions-row">
                <span className="muted small"># nagłówek · ## sekcja · - punkt · **pogrubienie**</span>
                <button className="btn primary small" style={{ marginLeft: "auto" }} onClick={save}>
                  Zapisz
                </button>
              </div>
              {error && <p className="error small">{error}</p>}
            </div>
          ) : (
            <Markdown source={doc.markdown} className="doc-preview" />
          )}
        </>
      ) : (
        <p className="muted small">Brak – poproś Claude o {DOC_LABEL[tab].toLowerCase()} do tej oferty.</p>
      )}
    </section>
  );
}

function PrepHint({ id }: { id: string }) {
  return (
    <p className="muted small">
      🎯 Przed rozmową napisz w Claude: <i>„przygotuj mnie do rozmowy {id}”</i> – pytania techniczne z wymagań oferty, Twoje przykłady z CV (STAR), pytania do firmy z researchu i na co uważać.
    </p>
  );
}
