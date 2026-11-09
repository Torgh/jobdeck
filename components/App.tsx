"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { agoTime } from "@/lib/format";
import { ACTIVE } from "@/lib/jobs";
import { paySettings } from "@/lib/pay";
import { SOURCE_LABEL, type SourceId } from "@/lib/types";
import type { BoardData } from "@/lib/view";
import { api, saveOnboarding, useBoard } from "./api";
import { Inbox } from "./Inbox";
import { TopNav, type AppTab } from "./Nav";
import { Pipeline } from "./Pipeline";
import { Today, todayCount } from "./Today";
import { Icon } from "./ui";

type Tab = AppTab;
const TAB_KEY = "jobdeck.tab";

export function App() {
  const { data, error, setError, load, update, undo, undoLast, dismissUndo } = useBoard();
  const [tab, setTab] = useState<Tab>("today");
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string>();
  /** ?job=<id> opens that offer (Claude links to cards like this). */
  const [linkedId, setLinkedId] = useState<string>();
  /** The linked offer and the view it lives in, decided once when the data arrives. */
  const [linked, setLinked] = useState<{ id: string; view: Tab }>();

  useEffect(() => {
    // ?tab=pipeline links straight to a view; otherwise the last one used.
    const params = new URLSearchParams(window.location.search);
    let saved: string | null = params.get("tab");
    const job = params.get("job");
    if (job) setTimeout(() => setLinkedId(job), 0);
    try {
      saved ??= localStorage.getItem(TAB_KEY);
    } catch {
      /* storage blocked */
    }
    if (saved === "pipeline" || saved === "inbox" || saved === "today") {
      const t: Tab = saved;
      setTimeout(() => setTab(t), 0);
    }
  }, []);

  const choose = (t: Tab) => {
    setTab(t);
    setLinked(undefined);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* storage blocked */
    }
  };

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(dismissUndo, 7000);
    return () => clearTimeout(t);
  }, [undo, dismissUndo]);

  const runScan = async () => {
    setScanning(true);
    setScanMsg(undefined);
    try {
      const r = await api<{ added: number; skipped: number; results: { source: SourceId; added: number; error?: string }[] }>("/api/scan", { method: "POST" });
      const errs = r.results.filter((s) => s.error).map((s) => `${SOURCE_LABEL[s.source]}: ${s.error}`);
      setScanMsg(`Dodano ${r.added} nowych ofert (odfiltrowano ${r.skipped}).${errs.length ? ` ⚠ ${errs.join("; ")}` : ""}`);
      if (r.added) choose("inbox");
      await load();
    } catch (e) {
      setScanMsg(`Skan nieudany: ${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  };

  const jobs = data?.jobs ?? [];
  if (linkedId && data) {
    // New offers are in the inbox, the rest on the pipeline. Derived once, during render.
    const job = jobs.find((j) => j.id === linkedId);
    setLinkedId(undefined);
    if (job) setLinked({ id: job.id, view: job.status === "new" ? "inbox" : "pipeline" });
  }
  const view: Tab = linked?.view ?? tab;
  const newCount = jobs.filter((j) => j.status === "new").length;
  const activeCount = jobs.filter((j) => ACTIVE.includes(j.status)).length;
  const skills = data ? { skills: data.profile.skills, cv: data.profile.cvText ? { text: data.profile.cvText } : undefined } : undefined;
  const companies = data?.companies ?? {};
  const payProfile = data?.profile.pay;
  const pay = useMemo(() => paySettings(payProfile), [payProfile]);

  const openJob = (id: string) => {
    const job = jobs.find((j) => j.id === id);
    if (job) setLinked({ id: job.id, view: job.status === "new" ? "inbox" : "pipeline" });
  };

  return (
    <div className="app">
      <TopNav
        active={view}
        counts={{ inbox: newCount, pipeline: activeCount, today: data ? todayCount(data) : undefined }}
        onTab={choose}
        right={
          <>
            <span className="muted small scan-info" title={data?.lastScan?.at}>
              {data?.lastScan ? `Skan ${agoTime(data.lastScan.at)}` : "Jeszcze nie skanowano"}
            </span>
            <button className="btn primary" onClick={runScan} disabled={scanning || !data?.profile.keywords.length} title={data?.profile.keywords.length ? "Szuka nowych ofert na portalach" : "Najpierw ustaw frazy w Ustawieniach"}>
              <Icon name="refresh" size={16} />
              {scanning ? "Skanuję…" : "Skanuj"}
            </button>
          </>
        }
      />

      {(error || scanMsg) && (
        <div className={`notice${error ? " bad" : ""}`}>
          {error ? `Błąd: ${error}` : scanMsg}
          <button className="btn ghost small" onClick={() => (error ? setError(undefined) : setScanMsg(undefined))} aria-label="Zamknij">
            ✕
          </button>
        </div>
      )}

      <main className="content">
        {!data ? (
          <div className="placeholder">Wczytuję…</div>
        ) : view === "today" ? (
          <Today data={data} pay={pay} onOpen={openJob} onTab={choose} onUpdate={update} onReload={load} onboarding={<Onboarding data={data} onScan={runScan} scanning={scanning} onSaved={load} />} />
        ) : view === "inbox" ? (
          <Inbox
            key={linked?.id}
            initialId={linked?.id}
            jobs={jobs}
            skills={skills}
            cvHash={data.profile.cvHash}
            companies={companies}
            pay={pay}
            onUpdate={update}
            onReload={load}
            onUndo={undoLast}
            empty={
              <div className="empty-state">
                <p>Brak nowych ofert.</p>
                <p className="muted small">{data.lastScan ? `Ostatni skan ${agoTime(data.lastScan.at)}.` : "Jeszcze nie było skanu."} Napisz w Claude „co nowego w JobDeck?” albo kliknij Skanuj.</p>
              </div>
            }
          />
        ) : (
          <Pipeline key={linked?.id} initialId={linked?.id} jobs={jobs} skills={skills} cvHash={data.profile.cvHash} companies={companies} pay={pay} onUpdate={update} onReload={load} />
        )}
      </main>

      {undo && (
        <div className="toast" role="status">
          {undo.label}
          <button className="btn small" onClick={undoLast}>
            Cofnij <kbd>Z</kbd>
          </button>
        </div>
      )}
    </div>
  );
}

function Onboarding({ data, onScan, scanning, onSaved }: { data: BoardData; onScan: () => void; scanning: boolean; onSaved: () => void }) {
  const ob = data.profile.onboarding ?? {};
  const tick = async (k: "alerts" | "gmail", v: boolean) => {
    await saveOnboarding({ ...ob, [k]: v });
    onSaved();
  };
  const steps: { done: boolean; title: string; body: React.ReactNode; manual?: "alerts" | "gmail" }[] = [
    { done: !!data.profile.cvFileName, title: "Wgraj CV", body: <><Link href="/settings">Ustawienia → Twoje CV</Link> (PDF z tekstem albo DOCX).</> },
    { done: data.profile.keywords.length > 0, title: "Ustaw frazy i preferencje", body: <>Frazy (np. „java, kotlin”), miasta, poziom, widełki – w <Link href="/settings">Ustawieniach</Link>.</> },
    { done: data.profile.skills.length > 0, title: "Umiejętności z CV", body: <>Napisz w Claude: <i>„wyciągnij umiejętności z mojego CV do JobDeck”</i>.</> },
    {
      done: !!ob.alerts,
      manual: "alerts",
      title: "Alerty e-mail na LinkedIn i Pracuj.pl",
      body: <>Na LinkedIn: Praca → wyszukaj → „Ustaw alert” (codziennie, e-mail). Na Pracuj.pl: „Zapisz wyszukiwanie” z powiadomieniem.</>,
    },
    { done: !!ob.gmail, manual: "gmail", title: "Podłącz Gmail w Claude", body: <>Wtedy Claude czyta alerty i sam dodaje oferty z LinkedIna i Pracuj.pl.</> },
    {
      done: !!data.lastScan,
      title: "Pierwszy skan",
      body: (
        <>
          <button className="link" onClick={onScan} disabled={scanning || !data.profile.keywords.length}>
            {scanning ? "Skanuję…" : "Skanuj teraz"}
          </button>{" "}
          albo napisz w Claude: <i>„co nowego w JobDeck?”</i>
        </>
      ),
    },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length || ob.hidden) return null;
  return (
    <div className="onboarding">
      <h3>Zacznij tutaj</h3>
      <div className="progress">
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <div className="muted small">
        {done} z {steps.length} gotowe
      </div>
      <ol>
        {steps.map((s) => (
          <li key={s.title} className={s.done ? "ok" : ""}>
            {s.manual ? (
              <input type="checkbox" checked={s.done} onChange={(e) => tick(s.manual!, e.target.checked)} aria-label={s.title} />
            ) : (
              <span className="check">{s.done ? "✓" : ""}</span>
            )}
            <div>
              <b>{s.title}</b>
              <div className="muted small">{s.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
