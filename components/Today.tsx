"use client";

import Link from "next/link";
import { useState } from "react";
import { agoTime } from "@/lib/format";
import { computeFunnel } from "@/lib/insights";
import { ACTIVE, compareJobs, type Todo } from "@/lib/jobs";
import { bestOnHand, formatOnHand, onHandRange, type B2bSettings } from "@/lib/pay";
import { formatSalary } from "@/lib/salary";
import { STATUS_LABEL, WORK_MODE_LABEL, type Job, type Status } from "@/lib/types";
import type { BoardData } from "@/lib/view";
import type { JobUpdate } from "./api";
import type { AppTab } from "./Nav";
import { Icon, ScoreRing, type IconName } from "./ui";

const TODO_LOOK: Record<Todo["kind"], { icon: IconName; tone: string; action: string }> = {
  next_step: { icon: "calendar", tone: "info", action: "Otwórz" },
  interview_prep: { icon: "target", tone: "info", action: "Przygotowanie" },
  follow_up: { icon: "mail", tone: "warn", action: "Szkic follow-upu" },
  expiring: { icon: "clock", tone: "bad", action: "Zobacz" },
  research: { icon: "building", tone: "calm", action: "Otwórz" },
  outdated_fit: { icon: "refresh", tone: "calm", action: "Zobacz" },
};

interface Task {
  key: string;
  icon: IconName;
  tone: string;
  title: string;
  sub?: string;
  action?: string;
  onAct?: () => void;
}

/** How many lines the "Do zrobienia" list has: the header badge shows the same number. */
export function todayCount(data: Pick<BoardData, "todos" | "jobs">): number {
  const research = data.todos.some((t) => t.kind === "research") ? 1 : 0;
  const fresh = data.jobs.some((j) => j.status === "new") ? 1 : 0;
  return data.todos.filter((t) => t.kind !== "research").length + research + fresh;
}

const PLURAL = (n: number) => (n === 1 ? "rzecz" : "rzeczy");

/** The start screen: what to do today, the best new offers to decide on, and where things stand. */
export function Today({
  data,
  pay,
  onboarding,
  onOpen,
  onTab,
  onUpdate,
}: {
  data: BoardData;
  pay: B2bSettings;
  onboarding?: React.ReactNode;
  onOpen: (id: string) => void;
  onTab: (t: AppTab) => void;
  onUpdate: (ids: string[], patch: JobUpdate, undoLabel?: string) => void;
}) {
  const [now] = useState(() => Date.parse(data.now));
  const jobs = data.jobs;
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const fresh = jobs.filter((j) => j.status === "new");
  const unrated = fresh.filter((j) => !j.fit).length;

  // Research is Claude's job: one line for all the companies instead of one per company.
  const research = data.todos.filter((t) => t.kind === "research");
  const tasks: Task[] = data.todos.filter((t) => t.kind !== "research").map((t) => {
    const look = TODO_LOOK[t.kind];
    const j = byId.get(t.jobId);
    const when = t.date ? ` · ${t.date.slice(8, 10)}.${t.date.slice(5, 7)}` : "";
    return {
      key: t.jobId + t.kind,
      icon: look.icon,
      tone: look.tone,
      title: t.short + when,
      sub: j ? `${j.title} · ${j.company}` : undefined,
      action: look.action,
      onAct: () => onOpen(t.jobId),
    };
  });
  if (research.length) {
    const names = research.map((t) => byId.get(t.jobId)?.company).filter(Boolean);
    tasks.push({
      key: "research",
      icon: "building",
      tone: "calm",
      title: research.length === 1 ? `Claude sprawdzi firmę ${names[0]}` : `Claude sprawdzi ${research.length} ${research.length % 10 >= 2 && research.length % 10 <= 4 && (research.length % 100 < 12 || research.length % 100 > 14) ? "firmy" : "firm"}`,
      sub: `${research.length > 1 ? `${names.join(", ")} – ` : ""}przy najbliższym „co nowego w JobDeck?” (opinie, czym się zajmują)`,
    });
  }
  if (fresh.length) {
    const good = fresh.filter((j) => (j.fit?.score ?? 0) >= 65).length;
    tasks.push({
      key: "inbox",
      icon: "sparkle",
      tone: "good",
      title: `Zdecyduj o ${fresh.length} ${fresh.length === 1 ? "nowej ofercie" : "nowych ofertach"}`,
      sub: unrated
        ? `${unrated} bez oceny – napisz w Claude „oceń nowe oferty w JobDeck”`
        : good
          ? `${good} z oceną 65+`
          : "Wszystkie ocenione",
      action: "Otwórz Skrzynkę",
      onAct: () => onTab("inbox"),
    });
  }

  const best = [...fresh].sort(compareJobs).slice(0, 3);
  const date = new Date(now).toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
  const headline = tasks.length ? `${tasks.length} ${PLURAL(tasks.length)} na dziś` : "Na dziś nic pilnego";
  const last = data.lastScan;

  return (
    <div className="today-page">
      <div className="today-wrap">
        <p className="today-date">{date.charAt(0).toUpperCase() + date.slice(1)}</p>
        <h1 className="today-title">{headline}</h1>
        <p className="today-sub">
          {last ? `Ostatni skan ${agoTime(last.at)}: ${last.added} nowych ofert. ` : "Jeszcze nie było skanu. "}
          {data.mailCheckedAt ? `Odpowiedzi z Gmaila sprawdzone ${agoTime(data.mailCheckedAt)}.` : "Odpowiedzi z Gmaila jeszcze niesprawdzone – napisz w Claude „co nowego w JobDeck?”."}
        </p>

        {onboarding}

        <div className="today-grid">
          <div className="today-main">
            {tasks.length > 0 && (
              <section className="panel tasks" aria-labelledby="tasks-h">
                <h2 id="tasks-h" className="eyebrow">
                  Do zrobienia
                </h2>
                {tasks.map((t) => (
                  <div key={t.key} className="task">
                    <span className={`task-icon ${t.tone}`}>
                      <Icon name={t.icon} size={20} />
                    </span>
                    <div className="task-text">
                      <div className="task-title">{t.title}</div>
                      {t.sub && <div className="task-sub">{t.sub}</div>}
                    </div>
                    {t.action && (
                      <button className="btn" onClick={t.onAct}>
                        {t.action}
                      </button>
                    )}
                  </div>
                ))}
              </section>
            )}

            {best.length > 0 && (
              <section aria-labelledby="best-h">
                <div className="section-head">
                  <h2 id="best-h">Najlepsze nowe oferty</h2>
                  <button className="link" onClick={() => onTab("inbox")}>
                    Wszystkie w Skrzynce ({fresh.length}) →
                  </button>
                </div>
                <div className="offer-cards">
                  {best.map((j) => (
                    <OfferCard key={j.id} job={j} pay={pay} onOpen={() => onOpen(j.id)} onUpdate={onUpdate} />
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="today-side">
            <FlowPanel jobs={jobs} onTab={onTab} />
            <WeekPanel jobs={jobs} now={now} />
            <LearnPanel plan={data.learningPlan} />
          </aside>
        </div>
      </div>
    </div>
  );
}

function OfferCard({ job, pay, onOpen, onUpdate }: { job: Job; pay: B2bSettings; onOpen: () => void; onUpdate: (ids: string[], patch: JobUpdate, undoLabel?: string) => void }) {
  const net = bestOnHand(job.salaries, pay);
  const sal = job.salaries.find((s) => onHandRange(s, pay)) ?? job.salaries[0];
  const place = job.workMode === "remote" ? WORK_MODE_LABEL.remote : [job.workMode && WORK_MODE_LABEL[job.workMode], job.location].filter(Boolean).join(" · ");
  return (
    <article className="offer-card">
      <div className="offer-top">
        <ScoreRing fit={job.fit} stack={job.stackMatch} size={48} />
        <div className="offer-head">
          <button className="offer-title" onClick={onOpen}>
            {job.title}
          </button>
          <div className="offer-sub">
            {job.company}
            {place && ` · ${place}`}
          </div>
        </div>
      </div>
      <div>
        {net != null ? (
          <div className="offer-net">
            {formatOnHand({ max: net }).replace(" na rękę", "")} <span>na rękę / mies.</span>
          </div>
        ) : (
          <div className="offer-net muted">Widełki nie podane</div>
        )}
        {sal && <div className="offer-gross">{formatSalary({ ...sal, monthlyPln: undefined })}</div>}
      </div>
      <p className="offer-why">{job.fit ? job.fit.summary : job.stackMatch != null ? `Jeszcze bez oceny · ${job.stackMatch}% technologii z Twojego CV.` : "Jeszcze bez oceny."}</p>
      {job.skills.length > 0 && (
        <div className="chips">
          {job.skills.slice(0, 4).map((s) => (
            <span key={s} className="chip">
              {s}
            </span>
          ))}
        </div>
      )}
      <div className="offer-actions">
        <button className="btn yes" onClick={() => onUpdate([job.id], { status: "interesting" }, "Przeniesiono do Ciekawe")}>
          Ciekawe
        </button>
        <button className="btn" onClick={() => onUpdate([job.id], { status: "closed", closedReason: "not_for_me" }, "Odrzucono")}>
          Nie dla mnie
        </button>
      </div>
    </article>
  );
}

const FLOW: Status[] = ["interesting", "applying", "applied", "interview", "offer"];

function FlowPanel({ jobs, onTab }: { jobs: Job[]; onTab: (t: AppTab) => void }) {
  const counts = FLOW.map((s) => ({ s, n: jobs.filter((j) => j.status === s).length }));
  const max = Math.max(1, ...counts.map((c) => c.n));
  const total = jobs.filter((j) => ACTIVE.includes(j.status)).length;
  return (
    <section className="panel side" aria-labelledby="flow-h">
      <div className="section-head">
        <h2 id="flow-h">W toku</h2>
        <button className="link" onClick={() => onTab("pipeline")}>
          Pipeline →
        </button>
      </div>
      {total ? (
        <div className="flow">
          {counts.map(({ s, n }) => (
            <div key={s} className="flow-row">
              <span>{STATUS_LABEL[s]}</span>
              <span className="flow-track">
                <span style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <b>{n}</b>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">Nic jeszcze nie jest w toku – oznacz ciekawe oferty w Skrzynce.</p>
      )}
    </section>
  );
}

function WeekPanel({ jobs, now }: { jobs: Job[]; now: number }) {
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString().slice(0, 10);
  const sent = jobs.filter((j) => j.appliedAt && j.appliedAt >= weekAgo).length;
  const f = computeFunnel(jobs, now);
  const applied = f.stages.find((s) => s.key === "applied")!.count;
  return (
    <section className="panel side" aria-labelledby="week-h">
      <h2 id="week-h">Ten tydzień</h2>
      <div className="week">
        <div>
          <b>{sent}</b>
          <span>{sent === 1 ? "wysłana aplikacja" : "wysłane aplikacje"}</span>
        </div>
        <div>
          <b>{f.responseRate != null ? `${Math.round(f.responseRate * 100)}%` : "–"}</b>
          <span>odpowiedzi{applied ? ` (z ${applied})` : ""}</span>
        </div>
      </div>
    </section>
  );
}

function LearnPanel({ plan }: { plan?: BoardData["learningPlan"] }) {
  const items = plan?.items ?? [];
  const next = items.find((i) => !i.done);
  const done = items.filter((i) => i.done).length;
  return (
    <section className="panel side" aria-labelledby="learn-h">
      <div className="section-head">
        <h2 id="learn-h">Plan nauki</h2>
        <Link href="/insights" className="small">
          Rynek →
        </Link>
      </div>
      {!items.length ? (
        <p className="muted small">Gdy Claude oceni kilkanaście ofert, napisz „zrób plan nauki z braków w JobDeck”.</p>
      ) : next ? (
        <>
          <p className="learn-next">Następne: {next.skill}</p>
          <p className="muted small">{next.project}</p>
          <div className="flow-track wide">
            <span style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
          <p className="muted small">
            {done} z {items.length} zrobione
          </p>
        </>
      ) : (
        <p className="muted small">Cały plan zrobiony – poproś Claude o nowy.</p>
      )}
    </section>
  );
}
