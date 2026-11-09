"use client";

import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useEffect, useState } from "react";
import { followUpState } from "@/lib/followup";
import { ago } from "@/lib/format";
import { compareJobs, companyResearch, staleness, type SkillSource } from "@/lib/jobs";
import { bestOnHand, formatOnHand, type B2bSettings } from "@/lib/pay";
import { formatSalary } from "@/lib/salary";
import { CLOSED_LABEL, STATUS_LABEL, WORK_MODE_LABEL, type CompanyInfo, type Job, type Status } from "@/lib/types";
import type { JobUpdate } from "./api";
import { JobDetail } from "./JobDetail";
import { Icon, Logo, ScoreRing } from "./ui";

const COLUMNS: Status[] = ["interesting", "applying", "applied", "interview", "offer"];
/** The list shows the stages closest to a job first. */
const GROUPS: Status[] = ["offer", "interview", "applied", "applying", "interesting"];
const VIEW_KEY = "jobdeck.pipelineView";

const HINT: Partial<Record<Status, string>> = {
  interesting: "Oferty oznaczone w Skrzynce jako ciekawe",
  applying: "Przygotowujesz CV / list",
  applied: "Czekasz na odpowiedź",
  interview: "Rozmowy w toku",
  offer: "Masz ofertę 🎉",
};

interface Props {
  jobs: Job[];
  skills?: SkillSource;
  cvHash?: string;
  companies: Record<string, CompanyInfo>;
  pay: B2bSettings;
  onUpdate: (ids: string[], patch: JobUpdate, undoLabel?: string) => void;
  onReload: () => void;
  initialId?: string;
}

/** The applications in progress as a kanban, with the open card beside it. */
export function Pipeline({ jobs, skills, cvHash, companies, pay, onUpdate, onReload, initialId }: Props) {
  const [openId, setOpenId] = useState<string | undefined>(initialId);
  const [showClosed, setShowClosed] = useState(false);
  const [layout, setLayout] = useState<"list" | "kanban">("list");
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "kanban") setTimeout(() => setLayout("kanban"), 0);
    } catch {
      /* storage blocked */
    }
  }, []);
  const pickLayout = (l: "list" | "kanban") => {
    setLayout(l);
    try {
      localStorage.setItem(VIEW_KEY, l);
    } catch {
      /* storage blocked */
    }
  };
  const open = jobs.find((j) => j.id === openId);
  const columns = showClosed ? [...COLUMNS, "closed" as Status] : COLUMNS;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenId(undefined);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onDragEnd = (e: DragEndEvent) => {
    const job = jobs.find((j) => j.id === String(e.active.id));
    const to = e.over?.id as Status | undefined;
    if (!job || !to || job.status === to) return;
    onUpdate([job.id], { status: to, ...(to === "closed" ? { closedReason: job.closedReason ?? "not_for_me" } : {}) }, `Przeniesiono do ${STATUS_LABEL[to]}`);
  };

  const active = jobs.filter((j) => COLUMNS.includes(j.status)).length;

  return (
    <div className={`pipeline${open ? " with-detail" : ""}`}>
      <div className="pipeline-board">
        <div className="pipeline-bar">
          <span className="muted small">
            {active ? `${active} w toku${layout === "kanban" ? " · przeciągaj karty między etapami" : ""}` : "Nic jeszcze nie jest w toku – oznacz oferty jako Ciekawe w Skrzynce."}
          </span>
          <span className="pipeline-tools">
            <label className="muted small toggle">
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> pokaż zamknięte
            </label>
            <span className="seg" role="group" aria-label="Widok">
              <button className={layout === "list" ? "active" : ""} aria-pressed={layout === "list"} onClick={() => pickLayout("list")}>
                <Icon name="list" size={15} /> Lista
              </button>
              <button className={layout === "kanban" ? "active" : ""} aria-pressed={layout === "kanban"} onClick={() => pickLayout("kanban")}>
                <Icon name="columns" size={15} /> Kanban
              </button>
            </span>
          </span>
        </div>
        {layout === "list" ? (
          <StageList jobs={jobs} stages={showClosed ? [...GROUPS, "closed"] : GROUPS} openId={openId} onOpen={setOpenId} pay={pay} />
        ) : (
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="columns">
              {columns.map((s) => (
                <Column key={s} status={s} jobs={jobs.filter((j) => j.status === s).sort(compareJobs)} openId={openId} onOpen={setOpenId} companies={companies} />
              ))}
            </div>
          </DndContext>
        )}
      </div>
      {open && (
        <aside className="pipeline-detail">
          <JobDetail
            key={open.id}
            job={open}
            mode="pipeline"
            skills={skills}
            cvHash={cvHash}
            companies={companies}
            pay={pay}
            onReload={onReload}
            onClose={() => setOpenId(undefined)}
            onUpdate={(patch, label) => onUpdate([open.id], patch, label)}
          />
        </aside>
      )}
    </div>
  );
}

function Column({ status, jobs, openId, onOpen, companies }: { status: Status; jobs: Job[]; openId?: string; onOpen: (id: string) => void; companies: Record<string, CompanyInfo> }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className={`column${isOver ? " over" : ""}${jobs.length ? "" : " empty"}`}>
      <header>
        <span>{STATUS_LABEL[status]}</span>
        <span className="count">{jobs.length}</span>
      </header>
      <div className="cards">
        {jobs.map((j) => (
          <Card key={j.id} job={j} selected={openId === j.id} onOpen={onOpen} researched={!!companyResearch(companies, j.company)} />
        ))}
        {!jobs.length && <div className="column-hint">{HINT[status] ?? "Pusto"}</div>}
      </div>
    </div>
  );
}

function Card({ job, selected, onOpen, researched }: { job: Job; selected: boolean; onOpen: (id: string) => void; researched: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({ id: job.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 20, position: "relative" as const } : undefined;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <button ref={setNodeRef} style={style} {...listeners} {...attributes} className={`card${isDragging ? " dragging" : ""}${selected ? " selected" : ""}`} onClick={() => onOpen(job.id)}>
      <div className="card-top">
        <Logo src={job.logo} name={job.company} size={32} />
        <div className="card-head">
          <div className="card-title">
            {job.starred && <span className="star">★ </span>}
            {job.title}
          </div>
          <div className="muted small">{job.company}</div>
        </div>
        <ScoreRing fit={job.fit} stack={job.stackMatch} size={34} />
      </div>
      <div className="card-meta small">
        {job.salaries[0] && <span className="row-salary">{formatSalary({ ...job.salaries[0], monthlyPln: undefined })}</span>}
        {job.workMode && <span className="muted">{WORK_MODE_LABEL[job.workMode]}</span>}
      </div>
      <div className="card-foot small">
        {job.nextStep ? (
          <span className={`step${job.nextStep.date && job.nextStep.date <= today ? " due" : ""}`}>
            ➜ {job.nextStep.text}
            {job.nextStep.date && ` · ${job.nextStep.date.slice(8, 10)}.${job.nextStep.date.slice(5, 7)}`}
          </span>
        ) : job.status === "closed" && job.closedReason ? (
          <span className="muted">{CLOSED_LABEL[job.closedReason]}</span>
        ) : (
          <span className="muted">{job.appliedAt ? `wysłano ${ago(job.appliedAt + "T12:00:00Z")}` : ago(job.statusChangedAt)}</span>
        )}
        {job.documents && Object.keys(job.documents).length > 0 && <span title="Ma dopasowane dokumenty">📄</span>}
        {staleness(job)?.level === "ghost" && <span title={staleness(job)!.text}>⏳</span>}
        {!researched && job.status !== "closed" && (
          <span className="muted" title="Firma jeszcze nie sprawdzona">
            🏢?
          </span>
        )}
      </div>
    </button>
  );
}

const GROUP_DOT: Record<Status, string> = {
  new: "calm",
  interesting: "calm",
  applying: "warn",
  applied: "good",
  interview: "info",
  offer: "strong",
  closed: "calm",
};

/** What the row should say next: the planned step, or what needs attention, or where it stands. */
function rowStep(job: Job, now: number): { text: string; tone: "info" | "warn" | "calm" } {
  if (job.nextStep) {
    const d = job.nextStep.date;
    return { text: `${job.nextStep.text}${d ? ` · ${d.slice(8, 10)}.${d.slice(5, 7)}` : ""}`, tone: d && d <= new Date(now).toISOString().slice(0, 10) ? "warn" : "info" };
  }
  const fu = followUpState(job, now);
  if (fu?.due) return { text: `Brak odpowiedzi ${fu.quietDays} dni · wyślij follow-up`, tone: "warn" };
  if (fu?.giveUp) return { text: `Cisza mimo ${fu.count} przypomnień · rozważ zamknięcie`, tone: "warn" };
  if (job.expiresAt && (job.status === "interesting" || job.status === "applying")) {
    const left = Math.ceil((Date.parse(job.expiresAt) - now) / 86_400_000);
    if (left >= 0 && left <= 3) return { text: `Wygasa za ${left} d`, tone: "warn" };
  }
  if (job.status === "closed") return { text: job.closedReason ? CLOSED_LABEL[job.closedReason] : "Zamknięte", tone: "calm" };
  if (job.status === "interview") return { text: "Rozmowy w toku · przygotuj się", tone: "info" };
  if (job.status === "offer") return { text: "Masz ofertę · negocjuj", tone: "info" };
  if (job.status === "applied") return { text: "Czekasz na odpowiedź", tone: "calm" };
  const docs = job.documents && (job.documents.cv || job.documents.letter);
  return { text: docs ? "Dokumenty gotowe · wyślij aplikację" : "Poproś Claude o CV i list", tone: "calm" };
}

function StageList({ jobs, stages, openId, onOpen, pay }: { jobs: Job[]; stages: Status[]; openId?: string; onOpen: (id: string) => void; pay: B2bSettings }) {
  const [now] = useState(() => Date.now());
  const groups = stages.map((s) => ({ s, list: jobs.filter((j) => j.status === s).sort(compareJobs) })).filter((g) => g.list.length);
  if (!groups.length) return <div className="placeholder">Tu pojawią się oferty, które oznaczysz jako Ciekawe.</div>;
  return (
    <div className="stage-list">
      {groups.map(({ s, list }) => (
        <section key={s} className="stage">
          <h2>
            <span className={`stage-dot ${GROUP_DOT[s]}`} />
            {STATUS_LABEL[s]}
            <span className="muted">{list.length}</span>
          </h2>
          {list.map((j) => {
            const step = rowStep(j, now);
            const net = bestOnHand(j.salaries, pay);
            const place = j.workMode === "remote" ? WORK_MODE_LABEL.remote : [j.workMode && WORK_MODE_LABEL[j.workMode], j.location].filter(Boolean).join(" · ");
            return (
              <button key={j.id} className={`stage-row${openId === j.id ? " selected" : ""}`} onClick={() => onOpen(j.id)}>
                <Logo src={j.logo} name={j.company} size={36} />
                <span className="stage-main">
                  <span className="stage-title">
                    {j.starred && <span className="star">★ </span>}
                    {j.title}
                  </span>
                  <span className="stage-sub">
                    {j.company}
                    {place && ` · ${place}`}
                  </span>
                </span>
                <ScoreRing fit={j.fit} stack={j.stackMatch} size={34} />
                <span className="stage-net">{net != null ? formatOnHand({ max: net }).replace(" na rękę", "") : "—"}</span>
                <span className={`stage-step ${step.tone}`}>{step.text}</span>
                <span className="stage-when muted small">{j.appliedAt ? `wysłano ${ago(j.appliedAt + "T12:00:00Z")}` : ago(j.statusChangedAt)}</span>
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
