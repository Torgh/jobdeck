"use client";

import { useEffect, useMemo, useState } from "react";
import { ago } from "@/lib/format";
import { ACTIVE, companyResearch, matchedSkills, type SkillSource } from "@/lib/jobs";
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
  type CompanyInfo,
  type Job,
  type Status,
} from "@/lib/types";
import { api, type JobUpdate } from "./api";
import { Kbd, Logo, ScoreRing } from "./ui";

interface Props {
  job: Job;
  mode: "inbox" | "pipeline";
  skills?: SkillSource;
  cvHash?: string;
  companies: Record<string, CompanyInfo>;
  onUpdate: (patch: JobUpdate, undoLabel?: string) => void;
  onClose?: () => void;
}

export function JobDetail({ job, mode, skills, cvHash, companies, onUpdate, onClose }: Props) {
  const [description, setDescription] = useState<{ id: string; text?: string; error?: string }>();
  const hits = useMemo(() => (skills ? matchedSkills([...job.skills, ...(job.niceSkills ?? [])], skills) : new Set<string>()), [job, skills]);
  const company = companyResearch(companies, job.company);

  useEffect(() => {
    let alive = true;
    api<{ job: Job }>(`/api/jobs/detail?id=${encodeURIComponent(job.id)}`)
      .then((r) => alive && setDescription({ id: job.id, text: r.job.description ?? r.job.summary ?? "" }))
      .catch((e) => alive && setDescription({ id: job.id, error: (e as Error).message }));
    return () => {
      alive = false;
    };
  }, [job.id]);

  const desc = description?.id === job.id ? description : undefined;
  const fit = job.fit;
  const outdated = fit?.cvHash && cvHash && fit.cvHash !== cvHash;
  const meta = [job.workMode && WORK_MODE_LABEL[job.workMode], job.location, job.seniority && SENIORITY_LABEL[job.seniority]].filter(Boolean);

  return (
    <article className="detail">
      <header className="detail-head">
        {onClose && (
          <button className="btn ghost back" onClick={onClose} aria-label="Zamknij">
            ←
          </button>
        )}
        <Logo src={job.logo} name={job.company} size={52} />
        <div className="detail-title">
          <h2>{job.title}</h2>
          <div className="muted">
            <b className="company-name">{job.company}</b>
            {meta.length > 0 && ` · ${meta.join(" · ")}`}
          </div>
          <div className="salary-big">{job.salaries.length ? job.salaries.map(formatSalary).join("  ·  ") : <span className="muted">Widełki nie podane</span>}</div>
        </div>
      </header>

      <div className="actions">
        {mode === "inbox" ? (
          <>
            <button className="btn yes" onClick={() => onUpdate({ status: "interesting" }, "Przeniesiono do Ciekawe")}>
              ✓ Ciekawe <Kbd>S</Kbd>
            </button>
            <button className="btn no" onClick={() => onUpdate({ status: "closed", closedReason: "not_for_me" }, "Odrzucono")}>
              ✗ Nie dla mnie <Kbd>X</Kbd>
            </button>
          </>
        ) : (
          <>
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
          </>
        )}
        <button className={`btn${job.starred ? " starred" : ""}`} onClick={() => onUpdate({ starred: !job.starred })} title="Wyróżnij">
          {job.starred ? "★" : "☆"}
        </button>
        <span className="spacer" />
        {job.links.filter((l, i, all) => all.findIndex((x) => x.source === l.source) === i).map((l, i) => (
          <a key={l.url} className="btn" href={l.url} target="_blank" rel="noreferrer">
            {SOURCE_LABEL[l.source]} ↗{i === 0 && mode === "inbox" && <Kbd>O</Kbd>}
          </a>
        ))}
      </div>

      <section className="box fit">
        <div className="box-head">
          <ScoreRing fit={fit} stack={job.stackMatch} size={46} />
          <div>
            <h3>{fit ? VERDICT_LABEL[fit.verdict] : "Jeszcze bez oceny"}</h3>
            <div className="muted small">{fit ? `Ocena Claude · ${ago(fit.ratedAt)}` : job.stackMatch != null ? `${job.stackMatch}% wymaganych technologii jest w Twoim CV` : "Brak listy technologii w ofercie"}</div>
          </div>
        </div>
        {fit ? (
          <>
            {outdated && <p className="warn-text">Oceniono na podstawie poprzedniego CV – poproś Claude o ponowną ocenę.</p>}
            <p>{fit.summary}</p>
            <ul className="pc">
              {fit.strengths.map((s) => (
                <li key={s} className="pro">
                  {s}
                </li>
              ))}
              {fit.gaps.map((s) => (
                <li key={s} className="con">
                  {s}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted small">
            Napisz w Claude: <i>„oceń ofertę {job.id} w JobDeck”</i> albo <i>„oceń nowe oferty”</i>.
          </p>
        )}
      </section>

      <CompanyBox company={company} job={job} />

      {(job.skills.length > 0 || !!job.niceSkills?.length) && (
        <section>
          <h4>Technologie</h4>
          <div className="chips">
            {job.skills.map((s) => (
              <span key={s} className={`chip${hits.has(s) ? " hit" : ""}`}>
                {hits.has(s) && "✓ "}
                {s}
              </span>
            ))}
            {job.niceSkills?.map((s) => (
              <span key={s} className={`chip nice${hits.has(s) ? " hit" : ""}`} title="mile widziane">
                {s}
              </span>
            ))}
          </div>
        </section>
      )}

      {mode === "pipeline" && <NextStep key={job.id} job={job} onUpdate={onUpdate} />}
      <Notes key={job.id} job={job} onUpdate={onUpdate} />

      <section>
        <h4>
          Opis oferty
          <span className="muted small" style={{ fontWeight: 400, marginLeft: 8, textTransform: "none", letterSpacing: 0 }}>
            opublikowana {job.publishedAt?.slice(0, 10) ?? "?"}
            {job.expiresAt && ` · wygasa ${job.expiresAt.slice(0, 10)}`}
            {job.appliedAt && ` · wysłano ${job.appliedAt}`}
          </span>
        </h4>
        {desc?.error ? <p className="warn-text">{desc.error}</p> : !desc ? <p className="muted">Pobieram opis…</p> : <div className="description">{desc.text || "(brak opisu)"}</div>}
      </section>
    </article>
  );
}

function CompanyBox({ company, job }: { company?: CompanyInfo; job: Job }) {
  if (!company) {
    return (
      <section className="box company empty">
        <h3>🏢 {job.company}</h3>
        <p className="muted small">
          {ACTIVE.includes(job.status)
            ? "Claude sprawdzi tę firmę (czym się zajmuje, opinie z GoWork, Glassdoor, Reddita) przy najbliższym „co nowego w JobDeck?” – albo napisz: „sprawdź firmę " + job.company + "”."
            : "Oznacz ofertę jako Ciekawą, a Claude sprawdzi firmę i opinie pracowników."}
        </p>
      </section>
    );
  }
  return (
    <section className="box company">
      <div className="box-head">
        <div>
          <h3>🏢 {company.name}</h3>
          <div className="muted small">{[company.kind, company.industry, company.size].filter(Boolean).join(" · ")}</div>
        </div>
        {company.website && (
          <a className="small" href={company.website.startsWith("http") ? company.website : `https://${company.website}`} target="_blank" rel="noreferrer" style={{ marginLeft: "auto" }}>
            strona ↗
          </a>
        )}
      </div>
      <p>{company.summary}</p>
      {company.ratings.length > 0 && (
        <div className="ratings">
          {company.ratings.map((r) => {
            const body = (
              <>
                <b>{r.score.toLocaleString("pl-PL")}</b>
                <span className="muted">/{r.outOf}</span> {r.site}
                {r.reviews != null && <span className="muted"> · {r.reviews} opinii</span>}
              </>
            );
            return r.url ? (
              <a key={r.site} className="rating" href={r.url} target="_blank" rel="noreferrer">
                {body}
              </a>
            ) : (
              <span key={r.site} className="rating">
                {body}
              </span>
            );
          })}
        </div>
      )}
      {(company.pros.length > 0 || company.cons.length > 0) && (
        <ul className="pc">
          {company.pros.map((s) => (
            <li key={s} className="pro">
              {s}
            </li>
          ))}
          {company.cons.map((s) => (
            <li key={s} className="con">
              {s}
            </li>
          ))}
        </ul>
      )}
      {company.flags.length > 0 && (
        <ul className="pc">
          {company.flags.map((s) => (
            <li key={s} className="flag">
              {s}
            </li>
          ))}
        </ul>
      )}
      <div className="muted small sources">
        Research {ago(company.researchedAt)}
        {company.sources.map((s) => (
          <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
            {s.title}
          </a>
        ))}
      </div>
    </section>
  );
}

function NextStep({ job, onUpdate }: { job: Job; onUpdate: Props["onUpdate"] }) {
  const [text, setText] = useState(job.nextStep?.text ?? "");
  const [date, setDate] = useState(job.nextStep?.date ?? "");
  const save = () => {
    if (text === (job.nextStep?.text ?? "") && date === (job.nextStep?.date ?? "")) return;
    onUpdate({ nextStep: text.trim() ? { text: text.trim(), date: date || undefined } : null });
  };
  return (
    <section>
      <h4>Następny krok</h4>
      <div className="nextstep">
        <input type="text" placeholder="np. Rozmowa techniczna, follow-up…" value={text} onChange={(e) => setText(e.target.value)} onBlur={save} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} onBlur={save} />
      </div>
    </section>
  );
}

function Notes({ job, onUpdate }: { job: Job; onUpdate: Props["onUpdate"] }) {
  const [notes, setNotes] = useState(job.notes ?? "");
  return (
    <section>
      <h4>Notatki</h4>
      <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (job.notes ?? "") && onUpdate({ notes })} placeholder="Kontakt z rekruterem, wrażenia, pytania…" />
    </section>
  );
}
