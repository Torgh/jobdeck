"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ago } from "@/lib/format";
import { compareJobs, type SkillSource } from "@/lib/jobs";
import { bestMonthly, formatSalary } from "@/lib/salary";
import { SOURCE_LABEL, SOURCES, WORK_MODE_LABEL, type CompanyInfo, type Job, type SourceId } from "@/lib/types";
import type { JobUpdate } from "./api";
import { JobDetail } from "./JobDetail";
import { Kbd, Logo, ScoreRing } from "./ui";

type Sort = "best" | "newest" | "salary";

const SORTS: Record<Sort, (a: Job, b: Job) => number> = {
  best: compareJobs,
  newest: (a, b) => (b.publishedAt ?? b.foundAt).localeCompare(a.publishedAt ?? a.foundAt),
  salary: (a, b) => {
    const top = (j: Job) => {
      const m = bestMonthly(j.salaries);
      return m?.max ?? m?.min ?? -1;
    };
    return top(b) - top(a);
  },
};

interface Props {
  jobs: Job[];
  skills?: SkillSource;
  cvHash?: string;
  companies: Record<string, CompanyInfo>;
  onUpdate: (ids: string[], patch: JobUpdate, undoLabel?: string) => void;
  onReload: () => void;
  onUndo: () => void;
  empty: React.ReactNode;
  initialId?: string;
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** New offers as a list beside the open one: sort them out quickly, by mouse or keyboard. */
export function Inbox({ jobs, skills, cvHash, companies, onUpdate, onReload, onUndo, empty, initialId }: Props) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceId | "">("");
  const [rated, setRated] = useState<"all" | "rated" | "unrated">("all");
  const [sort, setSort] = useState<Sort>("best");
  const [selectedId, setSelectedId] = useState<string | undefined>(initialId);
  const [mobileOpen, setMobileOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs
      .filter((j) => j.status === "new")
      .filter((j) => !q || `${j.title} ${j.company} ${j.skills.join(" ")} ${j.location ?? ""}`.toLowerCase().includes(q))
      .filter((j) => !source || j.links.some((l) => l.source === source))
      .filter((j) => rated === "all" || (rated === "rated" ? !!j.fit : !j.fit))
      .sort(SORTS[sort]);
  }, [jobs, query, source, rated, sort]);

  // Keep a valid selection: the chosen offer, or the one now in its place after it left the list.
  const index = Math.max(0, list.findIndex((j) => j.id === selectedId));
  const selected = list.length ? (list.find((j) => j.id === selectedId) ?? list[Math.min(index, list.length - 1)]) : undefined;

  const move = (delta: number) => {
    if (!list.length) return;
    const i = Math.max(0, list.findIndex((j) => j.id === selected?.id));
    const next = list[Math.min(list.length - 1, Math.max(0, i + delta))];
    setSelectedId(next.id);
    listRef.current?.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
  };

  /** Acts on the open offer and moves on to the next one. */
  const decide = (patch: JobUpdate, label: string) => {
    if (!selected) return;
    const i = list.findIndex((j) => j.id === selected.id);
    const next = list[i + 1] ?? list[i - 1];
    setSelectedId(next?.id);
    onUpdate([selected.id], patch, label);
  };

  // A linked offer (?job=) may be far down the list: bring it into view once.
  useEffect(() => {
    if (initialId) listRef.current?.querySelector(`[data-id="${initialId}"]`)?.scrollIntoView({ block: "center" });
  }, [initialId]);

  const keys = useRef<(e: KeyboardEvent) => void>(undefined);
  useEffect(() => {
    keys.current = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (typing(e.target)) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "j" || e.key === "ArrowDown") move(1);
      else if (k === "k" || e.key === "ArrowUp") move(-1);
      else if (k === "s") decide({ status: "interesting" }, "Przeniesiono do Ciekawe");
      else if (k === "x") decide({ status: "closed", closedReason: "not_for_me" }, "Odrzucono");
      else if (k === "f" && selected) onUpdate([selected.id], { starred: !selected.starred });
      else if (k === "o" && selected) window.open(selected.url, "_blank", "noopener");
      else if (k === "z") onUndo();
      else if (e.key === "/") search.current?.focus();
      else return;
      e.preventDefault();
    };
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current?.(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const newCount = jobs.filter((j) => j.status === "new").length;

  return (
    <div className={`inbox${mobileOpen && selected ? " show-detail" : ""}`}>
      <div className="inbox-list">
        <div className="filters">
          <input ref={search} type="search" placeholder="Szukaj…  /" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="filter-row">
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sortuj">
              <option value="best">Najlepsze</option>
              <option value="newest">Najnowsze</option>
              <option value="salary">Widełki</option>
            </select>
            <select value={rated} onChange={(e) => setRated(e.target.value as typeof rated)} aria-label="Ocena">
              <option value="all">Wszystkie</option>
              <option value="rated">Ocenione</option>
              <option value="unrated">Bez oceny</option>
            </select>
            <select value={source} onChange={(e) => setSource(e.target.value as SourceId | "")} aria-label="Źródło">
              <option value="">Każde źródło</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="muted small">
            {list.length === newCount ? `${newCount} nowych ofert` : `${list.length} z ${newCount} nowych ofert`}
          </div>
        </div>
        <div className="rows" ref={listRef}>
          {list.map((j) => (
            <button
              key={j.id}
              data-id={j.id}
              className={`row${selected?.id === j.id ? " selected" : ""}`}
              onClick={() => {
                setSelectedId(j.id);
                setMobileOpen(true);
              }}
            >
              <ScoreRing fit={j.fit} stack={j.stackMatch} size={38} />
              <div className="row-main">
                <div className="row-title">
                  {j.starred && <span className="star">★ </span>}
                  {j.title}
                </div>
                <div className="row-sub">
                  <Logo src={j.logo} name={j.company} size={16} />
                  <span>{j.company}</span>
                  {(j.workMode || j.location) && <span className="muted">· {j.workMode === "remote" ? WORK_MODE_LABEL.remote : (j.location ?? WORK_MODE_LABEL[j.workMode!])}</span>}
                </div>
                <div className="row-meta">
                  <span className="row-salary">{j.salaries[0] ? formatSalary({ ...j.salaries[0], monthlyPln: undefined }) : "—"}</span>
                  <span className="muted">{ago(j.publishedAt ?? j.foundAt)}</span>
                </div>
              </div>
            </button>
          ))}
          {!list.length && <div className="rows-empty">{newCount ? "Nic nie pasuje do filtrów." : empty}</div>}
        </div>
        <div className="keys muted small">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> · <Kbd>S</Kbd> ciekawe · <Kbd>X</Kbd> odrzuć · <Kbd>F</Kbd> ★ · <Kbd>Z</Kbd> cofnij
        </div>
      </div>
      <div className="inbox-detail">
        {selected ? (
          <JobDetail
            key={selected.id}
            job={selected}
            mode="inbox"
            skills={skills}
            cvHash={cvHash}
            companies={companies}
            onReload={onReload}
            onClose={() => setMobileOpen(false)}
            onUpdate={(patch, label) => (label ? decide(patch, label) : onUpdate([selected.id], patch))}
          />
        ) : (
          <div className="placeholder">{newCount ? "Wybierz ofertę z listy." : empty}</div>
        )}
      </div>
    </div>
  );
}
