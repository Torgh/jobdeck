"use client";

import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useEffect, useState } from "react";
import { ago } from "@/lib/format";
import { compareJobs, companyResearch, type SkillSource } from "@/lib/jobs";
import { formatSalary } from "@/lib/salary";
import { CLOSED_LABEL, STATUS_LABEL, WORK_MODE_LABEL, type CompanyInfo, type Job, type Status } from "@/lib/types";
import type { JobUpdate } from "./api";
import { JobDetail } from "./JobDetail";
import { Logo, ScoreRing } from "./ui";

const COLUMNS: Status[] = ["interesting", "applying", "applied", "interview", "offer"];

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
  onUpdate: (ids: string[], patch: JobUpdate, undoLabel?: string) => void;
  onReload: () => void;
  initialId?: string;
}

/** The applications in progress as a kanban, with the open card beside it. */
export function Pipeline({ jobs, skills, cvHash, companies, onUpdate, onReload, initialId }: Props) {
  const [openId, setOpenId] = useState<string | undefined>(initialId);
  const [showClosed, setShowClosed] = useState(false);
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
          <span className="muted small">{active ? `${active} w toku · przeciągaj karty między etapami` : "Nic jeszcze nie jest w toku – oznacz oferty jako Ciekawe w Skrzynce."}</span>
          <label className="muted small toggle">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> pokaż zamknięte
          </label>
        </div>
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="columns">
            {columns.map((s) => (
              <Column key={s} status={s} jobs={jobs.filter((j) => j.status === s).sort(compareJobs)} openId={openId} onOpen={setOpenId} companies={companies} />
            ))}
          </div>
        </DndContext>
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
        {!researched && job.status !== "closed" && (
          <span className="muted" title="Firma jeszcze nie sprawdzona">
            🏢?
          </span>
        )}
      </div>
    </button>
  );
}
