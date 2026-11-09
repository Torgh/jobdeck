"use client";

import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ago, agoTime, fitClass } from "@/lib/format";
import { compareJobs, matchedSkills } from "@/lib/jobs";
import { formatSalary } from "@/lib/salary";
import { SOURCE_LABEL, SOURCES, STATUS_LABEL, STATUSES, WORK_MODE_LABEL, type Job, type SourceId, type Status } from "@/lib/types";
import type { BoardData } from "@/lib/view";
import { JobDrawer } from "./JobDrawer";

const POLL_MS = 8000;

/** A change to a card; nextStep null clears it. */
export type JobUpdate = Partial<Omit<Job, "nextStep">> & { nextStep?: Job["nextStep"] | null };
const PAGE = 60;

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export function patchJobs(ids: string[], patch: Record<string, unknown>) {
  return api<{ jobs: Job[] }>("/api/jobs", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, patch }),
  });
}

export function Board() {
  const [data, setData] = useState<BoardData>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceId | "">("");
  const [minScore, setMinScore] = useState(0);
  const [showClosed, setShowClosed] = useState(false);
  const [openId, setOpenId] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string>();
  const pending = useRef(0);

  const load = useCallback(async () => {
    if (pending.current) return;
    try {
      const d = await api<BoardData>("/api/jobs");
      setData((old) => (old && old.version === d.version && old.profile.cvHash === d.profile.cvHash ? old : d));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // First load plus polling: Claude (MCP) changes the same data in the background.
    const first = setTimeout(load, 0);
    const t = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  /** Optimistic change + save; the next poll brings the server's version. */
  const update = useCallback(
    async (ids: string[], patch: JobUpdate) => {
      setData((d) => d && { ...d, jobs: d.jobs.map((j) => (ids.includes(j.id) ? ({ ...j, ...patch } as Job) : j)) });
      pending.current++;
      try {
        const { jobs } = await patchJobs(ids, patch);
        setData((d) => d && { ...d, jobs: d.jobs.map((j) => jobs.find((n) => n.id === j.id) ?? j) });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        pending.current--;
        load();
      }
    },
    [load],
  );

  const runScan = async () => {
    setScanning(true);
    setScanMsg(undefined);
    try {
      const r = await api<{ added: number; results: { source: SourceId; added: number; error?: string }[] }>("/api/scan", { method: "POST" });
      const errs = r.results.filter((s) => s.error).map((s) => `${SOURCE_LABEL[s.source]}: ${s.error}`);
      setScanMsg(`Dodano ${r.added} nowych ofert.${errs.length ? ` ⚠ ${errs.join("; ")}` : ""}`);
      await load();
    } catch (e) {
      setScanMsg(`Skan nieudany: ${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.jobs
      .filter((j) => !q || `${j.title} ${j.company} ${j.skills.join(" ")} ${j.location ?? ""}`.toLowerCase().includes(q))
      .filter((j) => !source || j.links.some((l) => l.source === source))
      .filter((j) => !minScore || (j.fit?.score ?? 0) >= minScore)
      .sort(compareJobs);
  }, [data, query, source, minScore]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id);
    const to = e.over?.id as Status | undefined;
    const job = data?.jobs.find((j) => j.id === id);
    if (!job || !to || job.status === to) return;
    update([id], { status: to, ...(to === "closed" ? { closedReason: job.closedReason ?? "not_for_me" } : {}) });
  };

  const columns = STATUSES.filter((s) => s !== "closed" || showClosed);
  const unrated = data?.jobs.filter((j) => j.status === "new" && !j.fit).length ?? 0;
  const openJob = data?.jobs.find((j) => j.id === openId);
  const profileLike = data ? { skills: data.profile.skills, cv: data.profile.cvText ? { text: data.profile.cvText } : undefined } : undefined;

  return (
    <>
      <div className="topbar">
        <Link href="/" className="logo">
          Job<span>Deck</span>
        </Link>
        <input type="search" placeholder="Szukaj: tytuł, firma, technologia…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={source} onChange={(e) => setSource(e.target.value as SourceId | "")} aria-label="Źródło">
          <option value="">Wszystkie źródła</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </select>
        <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} aria-label="Minimalna ocena">
          <option value={0}>Każda ocena</option>
          <option value={45}>Ocena 45+</option>
          <option value={65}>Ocena 65+</option>
          <option value={80}>Ocena 80+</option>
        </select>
        <label className="muted" style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> zamknięte
        </label>
        <span className="spacer" />
        <span className="muted" title={data?.lastScan?.at}>
          {data?.lastScan ? `Skan: ${agoTime(data.lastScan.at)}` : "Jeszcze nie skanowano"}
        </span>
        <button className="btn primary" onClick={runScan} disabled={scanning}>
          {scanning ? "Skanuję…" : "Skanuj portale"}
        </button>
        <Link className="btn" href="/settings">
          Ustawienia
        </Link>
      </div>

      {error && <div className="banner warn">Błąd: {error}</div>}
      {scanMsg && <div className="banner">{scanMsg}</div>}
      {data && !data.profile.cvFileName && (
        <div className="banner warn">
          Nie ma jeszcze Twojego CV. <Link href="/settings">Wgraj je w Ustawieniach</Link>, żeby Claude mógł oceniać dopasowanie ofert.
        </div>
      )}
      {data && !data.profile.keywords.length && (
        <div className="banner warn">
          Ustaw frazy wyszukiwania (np. „java”, „react”) w <Link href="/settings">Ustawieniach</Link>, zanim uruchomisz skan.
        </div>
      )}
      {unrated > 0 && data?.profile.cvFileName && (
        <div className="banner">
          <b>{unrated}</b> {unrated === 1 ? "nowa oferta czeka" : "nowych ofert czeka"} na ocenę. Napisz w Claude: <i>„oceń nowe oferty w JobDeck”</i>.
        </div>
      )}
      {!!data?.todos.length && (
        <div className="banner warn">
          <b>Do ogarnięcia</b>
          <ul>
            {data.todos.map((t) => (
              <li key={t.jobId + t.kind}>
                <button onClick={() => setOpenId(t.jobId)}>{t.text}</button>
                {t.date && <span className="muted"> · {t.date}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="board">
          {columns.map((s) => (
            <Column
              key={s}
              status={s}
              jobs={filtered.filter((j) => j.status === s)}
              onOpen={setOpenId}
              selected={openId}
              profile={profileLike}
            />
          ))}
        </div>
      </DndContext>

      {openJob && (
        <JobDrawer
          key={openJob.id}
          job={openJob}
          profile={profileLike}
          cvHash={data?.profile.cvHash}
          onClose={() => setOpenId(undefined)}
          onUpdate={(patch) => update([openJob.id], patch)}
        />
      )}
    </>
  );
}

type ProfileLike = { skills: string[]; cv?: { text: string } } | undefined;

function Column({ status, jobs, onOpen, selected, profile }: { status: Status; jobs: Job[]; onOpen: (id: string) => void; selected?: string; profile: ProfileLike }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const [limit, setLimit] = useState(PAGE);
  return (
    <div ref={setNodeRef} className={`column${isOver ? " over" : ""}`}>
      <header>
        <span>{STATUS_LABEL[status]}</span>
        <span className="count">{jobs.length}</span>
      </header>
      <div className="cards">
        {jobs.slice(0, limit).map((j) => (
          <Card key={j.id} job={j} onOpen={onOpen} selected={selected === j.id} profile={profile} />
        ))}
        {!jobs.length && <div className="muted" style={{ padding: "8px 4px", fontSize: 13 }}>Pusto</div>}
      </div>
      {jobs.length > limit && (
        <button className="btn more" onClick={() => setLimit((l) => l + PAGE)}>
          Pokaż więcej ({jobs.length - limit})
        </button>
      )}
    </div>
  );
}

function Card({ job, onOpen, selected, profile }: { job: Job; onOpen: (id: string) => void; selected: boolean; profile: ProfileLike }) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({ id: job.id });
  const hits = useMemo(() => (profile ? matchedSkills(job.skills, profile) : new Set<string>()), [job.skills, profile]);
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 20, position: "relative" as const } : undefined;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <button
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`card${isDragging ? " dragging" : ""}${selected ? " selected" : ""}`}
      onClick={() => onOpen(job.id)}
    >
      <div className="row">
        <div className="title">
          {job.starred && "⭐ "}
          {job.title}
        </div>
        {job.fit ? (
          <span className={`score ${fitClass(job.fit)}`} title={`Ocena Claude: ${job.fit.summary}`}>
            {job.fit.score}
          </span>
        ) : job.stackMatch != null ? (
          <span className="score stack" title="Ile wymaganych technologii jest w CV (bez oceny Claude)">
            {job.stackMatch}%
          </span>
        ) : null}
      </div>
      <div className="company">
        {job.company}
        {(job.workMode || job.location) && ` · ${[job.workMode && WORK_MODE_LABEL[job.workMode], job.location].filter(Boolean).join(", ")}`}
      </div>
      {job.salaries[0] && <div className="salary">{formatSalary(job.salaries[0])}</div>}
      {job.fit && <div className="fitline">{job.fit.summary}</div>}
      {!!job.skills.length && (
        <div className="chips">
          {job.skills.slice(0, 6).map((s) => (
            <span key={s} className={`chip${hits.has(s) ? " hit" : ""}`}>
              {s}
            </span>
          ))}
          {job.skills.length > 6 && <span className="chip">+{job.skills.length - 6}</span>}
        </div>
      )}
      <div className="foot">
        {[...new Set(job.links.map((l) => l.source))].map((s) => (
          <span key={s} className="tag">
            {SOURCE_LABEL[s]}
          </span>
        ))}
        {job.nextStep && (
          <span className={`tag${job.nextStep.date && job.nextStep.date <= today ? " due" : ""}`}>
            ➜ {job.nextStep.text}
            {job.nextStep.date ? ` ${job.nextStep.date.slice(5)}` : ""}
          </span>
        )}
        <span style={{ marginLeft: "auto" }}>{ago(job.publishedAt ?? job.foundAt)}</span>
      </div>
    </button>
  );
}
