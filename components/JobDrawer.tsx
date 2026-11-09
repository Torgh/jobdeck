"use client";

import { useEffect, useMemo, useState } from "react";
import { ago, fitClass } from "@/lib/format";
import { matchedSkills } from "@/lib/jobs";
import { formatSalary } from "@/lib/salary";
import {
  CLOSED_LABEL,
  CLOSED_REASONS,
  SENIORITY_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  STATUSES,
  VERDICT_LABEL,
  WORK_MODE_LABEL,
  type ClosedReason,
  type Job,
  type Status,
} from "@/lib/types";
import { api, type JobUpdate } from "./Board";

interface Props {
  job: Job;
  profile: { skills: string[]; cv?: { text: string } } | undefined;
  cvHash?: string;
  onClose: () => void;
  onUpdate: (patch: JobUpdate) => void;
}

export function JobDrawer({ job, profile, cvHash, onClose, onUpdate }: Props) {
  const [description, setDescription] = useState<string>();
  const [descError, setDescError] = useState<string>();
  const [notes, setNotes] = useState(job.notes ?? "");
  const [stepText, setStepText] = useState(job.nextStep?.text ?? "");
  const [stepDate, setStepDate] = useState(job.nextStep?.date ?? "");
  const hits = useMemo(() => (profile ? matchedSkills([...job.skills, ...(job.niceSkills ?? [])], profile) : new Set<string>()), [job, profile]);

  useEffect(() => {
    let alive = true;
    api<{ job: Job }>(`/api/jobs/detail?id=${encodeURIComponent(job.id)}`)
      .then((r) => alive && setDescription(r.job.description ?? r.job.summary ?? ""))
      .catch((e) => alive && setDescError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [job.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const saveStep = () => {
    if (stepText === (job.nextStep?.text ?? "") && stepDate === (job.nextStep?.date ?? "")) return;
    onUpdate({ nextStep: stepText.trim() ? { text: stepText.trim(), date: stepDate || undefined } : null });
  };

  const fit = job.fit;
  const outdated = fit?.cvHash && cvHash && fit.cvHash !== cvHash;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={job.title}>
        <button className="btn close" onClick={onClose} aria-label="Zamknij">
          ✕
        </button>
        <h2>{job.title}</h2>
        <div className="muted">
          {job.company}
          {job.location && ` · ${job.location}`}
        </div>

        <div className="controls">
          <select value={job.status} onChange={(e) => onUpdate({ status: e.target.value as Status })} aria-label="Status">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {job.status === "closed" && (
            <select value={job.closedReason ?? "not_for_me"} onChange={(e) => onUpdate({ closedReason: e.target.value as ClosedReason })} aria-label="Powód">
              {CLOSED_REASONS.map((r) => (
                <option key={r} value={r}>
                  {CLOSED_LABEL[r]}
                </option>
              ))}
            </select>
          )}
          <button className="btn" onClick={() => onUpdate({ starred: !job.starred })}>
            {job.starred ? "⭐ Wyróżniona" : "☆ Wyróżnij"}
          </button>
          {job.links.map((l) => (
            <a key={l.url} className="btn" href={l.url} target="_blank" rel="noreferrer">
              {SOURCE_LABEL[l.source]} ↗
            </a>
          ))}
        </div>

        <section>
          <h3>Dopasowanie do CV</h3>
          {fit ? (
            <div className="fitbox">
              <div className="head">
                <span className={`score ${fitClass(fit)}`}>{fit.score}</span>
                <span>{VERDICT_LABEL[fit.verdict]}</span>
                <span className="muted" style={{ fontWeight: 400, marginLeft: "auto", fontSize: 12 }}>
                  ocena Claude, {ago(fit.ratedAt)}
                </span>
              </div>
              {outdated && <p className="error" style={{ margin: "8px 0 0" }}>Oceniono na podstawie poprzedniego CV – poproś Claude o ponowną ocenę.</p>}
              <p style={{ margin: "8px 0 0" }}>{fit.summary}</p>
              <ul>
                {fit.strengths.map((s) => (
                  <li key={s}>
                    <span className="ok">✓</span> {s}
                  </li>
                ))}
                {fit.gaps.map((s) => (
                  <li key={s}>
                    <span className="error">✗</span> {s}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Jeszcze nie oceniona. Napisz w Claude: <i>„oceń ofertę {job.id} w JobDeck”</i>
              {job.stackMatch != null && <> · technologie z CV: {job.stackMatch}%</>}
            </p>
          )}
        </section>

        <section>
          <h3>Szczegóły</h3>
          <dl className="facts">
            <dt>Wynagrodzenie</dt>
            <dd>{job.salaries.length ? job.salaries.map((s, i) => <div key={i}>{formatSalary(s)}</div>) : "nie podano"}</dd>
            <dt>Tryb</dt>
            <dd>{job.workMode ? WORK_MODE_LABEL[job.workMode] : "?"}</dd>
            <dt>Poziom</dt>
            <dd>{job.seniority ? SENIORITY_LABEL[job.seniority] : "?"}</dd>
            <dt>Opublikowana</dt>
            <dd>
              {job.publishedAt?.slice(0, 10) ?? "?"}
              {job.expiresAt && <span className="muted"> · wygasa {job.expiresAt.slice(0, 10)}</span>}
            </dd>
            {job.appliedAt && (
              <>
                <dt>Wysłano</dt>
                <dd>{job.appliedAt}</dd>
              </>
            )}
          </dl>
          {!!job.skills.length && (
            <div className="chips" style={{ marginTop: 10 }}>
              {job.skills.map((s) => (
                <span key={s} className={`chip${hits.has(s) ? " hit" : ""}`}>
                  {s}
                </span>
              ))}
              {job.niceSkills?.map((s) => (
                <span key={s} className={`chip${hits.has(s) ? " hit" : ""}`} title="mile widziane">
                  {s}?
                </span>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3>Następny krok</h3>
          <div className="nextstep">
            <input type="text" placeholder="np. Rozmowa techniczna, follow-up…" value={stepText} onChange={(e) => setStepText(e.target.value)} onBlur={saveStep} />
            <input type="date" value={stepDate} onChange={(e) => setStepDate(e.target.value)} onBlur={saveStep} />
          </div>
        </section>

        <section>
          <h3>Notatki</h3>
          <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (job.notes ?? "") && onUpdate({ notes })} placeholder="Kontakt z rekruterem, wrażenia, pytania…" />
        </section>

        <section>
          <h3>Opis oferty</h3>
          {descError ? (
            <p className="error">{descError}</p>
          ) : description === undefined ? (
            <p className="muted">Pobieram opis…</p>
          ) : (
            <div className="description">{description || "(brak opisu)"}</div>
          )}
        </section>
      </aside>
    </>
  );
}
