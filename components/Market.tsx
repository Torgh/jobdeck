"use client";

import { useEffect, useState } from "react";
import type { Funnel, Insights, SalaryBand } from "@/lib/insights";
import { ago } from "@/lib/format";
import { SENIORITY_LABEL, SOURCE_LABEL, type LearningPlan, type Seniority } from "@/lib/types";
import { api } from "./api";
import { TopNav } from "./Nav";

const k = (v: number) => `${(v / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })}k`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

const CONTRACT_NAME = { b2b: "B2B netto", uop: "UoP brutto" } as const;

type MarketData = { insights: Insights; funnel: Funnel; minMonthlyPln: number | null; learningPlan: LearningPlan | null };

/** What the collected offers say: salaries by level, skills in demand, recurring gaps, sources. */
export function Market() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<MarketData>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    api<MarketData>(`/api/insights?days=${days}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [days]);

  const ins = data?.insights;
  const median = (c: "b2b" | "uop") => ins?.salary.find((s) => s.contract === c && s.seniority === "all");

  return (
    <>
      <TopNav active="insights" />
      <div className="page wide viz-root">
        <div className="viz-filters">
          <div className="seg">
            {[
              [30, "30 dni"],
              [90, "90 dni"],
              [0, "Wszystko"],
            ].map(([d, label]) => (
              <button key={d} className={days === d ? "active" : ""} onClick={() => setDays(d as number)}>
                {label}
              </button>
            ))}
          </div>
          <span className="muted small">Z ofert zebranych przez Tropiciela (Twoje frazy i filtry) – nie cały rynek.</span>
        </div>

        {error && <p className="error">{error}</p>}
        {!ins ? (
          <p className="muted">Wczytuję…</p>
        ) : ins.total === 0 ? (
          <div className="panel">Brak ofert w tym okresie – uruchom skan.</div>
        ) : (
          <>
            <div className="kpis">
              <Tile label="Ofert" value={String(ins.total)} sub={`${pct(ins.withSalary / ins.total)} z widełkami`} />
              <Tile label="Mediana B2B" value={median("b2b") ? k(median("b2b")!.median) : "–"} sub={median("b2b") ? `netto / mies. · ${median("b2b")!.n} ofert` : "za mało ofert"} />
              <Tile label="Mediana UoP" value={median("uop") ? k(median("uop")!.median) : "–"} sub={median("uop") ? `brutto / mies. · ${median("uop")!.n} ofert` : "za mało ofert"} />
              <Tile label="Średnie dopasowanie" value={ins.avgFit != null ? String(ins.avgFit) : "–"} sub={`${ins.rated} ocenionych przez Claude`} />
            </div>

            <FunnelSection funnel={data.funnel} />

            <SalaryChart bands={ins.salary} minMonthly={data.minMonthlyPln} />

            <div className="viz-two">
              <SkillsChart skills={ins.skills.slice(0, 15)} total={ins.total} />
              <GapsChart gaps={ins.gaps} />
            </div>

            <LearningSection plan={data.learningPlan} hasGaps={ins.gaps.length > 0} onChange={(learningPlan) => setData({ ...data, learningPlan })} />

            <section className="panel">
              <h2>Źródła</h2>
              <p className="hint">Skąd przychodzą oferty, które do Ciebie pasują i kończą się rozmową.</p>
              <div className="table-wrap">
                <table className="viz-table">
                  <thead>
                    <tr>
                      <th>Źródło</th>
                      <th>Oferty</th>
                      <th>Ocenione</th>
                      <th>Śr. ocena</th>
                      <th>Ocena 65+</th>
                      <th>Wybrane</th>
                      <th>Wysłane</th>
                      <th>Rozmowy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ins.sources.map((s) => (
                      <tr key={s.source}>
                        <td>{SOURCE_LABEL[s.source]}</td>
                        <td>{s.offers}</td>
                        <td>{s.rated}</td>
                        <td>{s.avgFit ?? "–"}</td>
                        <td>{s.good}</td>
                        <td>{s.picked}</td>
                        <td>{s.applied}</td>
                        <td>{s.interviews}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <p className="muted small">
              Widełki: środek przedziału z każdej oferty, w PLN miesięcznie (stawki godzinowe × 168, waluty po kursie NBP). Pasek to środkowa połowa ofert (25.–75. percentyl), kropka – mediana.
              Poziomy z co najmniej 3 ofertami. Szczegółową interpretację da Claude: <i>„co mówi rynek w Tropicielu?”</i>
            </p>
          </>
        )}
      </div>
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="muted small">{sub}</div>
    </div>
  );
}

const LEVELS: Seniority[] = ["junior", "mid", "senior", "lead"];

function ticks(max: number): number[] {
  const step = max > 40_000 ? 10_000 : 5_000;
  return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
}

/** Range plot: per level, the middle half of offers (p25–p75) with the median, B2B and UoP on one axis. */
function SalaryChart({ bands, minMonthly }: { bands: SalaryBand[]; minMonthly: number | null }) {
  const rows = LEVELS.filter((l) => bands.some((b) => b.seniority === l));
  if (!rows.length) {
    return (
      <section className="panel">
        <h2>Widełki według poziomu</h2>
        <p className="muted">Za mało ofert z widełkami, żeby pokazać rozkład.</p>
      </section>
    );
  }
  const top = Math.max(...bands.map((b) => b.p75), minMonthly ?? 0) * 1.08;
  const max = Math.ceil(top / 5000) * 5000;
  const x = (v: number) => `${(v / max) * 100}%`;
  const contracts = (["b2b", "uop"] as const).filter((c) => bands.some((b) => b.contract === c && b.seniority !== "all"));
  return (
    <section className="panel">
      <h2>Widełki według poziomu</h2>
      <div className="legend">
        {contracts.map((c) => (
          <span key={c}>
            <i className={`swatch s-${c}`} /> {CONTRACT_NAME[c]}
          </span>
        ))}
        {minMonthly ? (
          <span>
            <i className="swatch s-min" /> Twoje minimum ({k(minMonthly)})
          </span>
        ) : null}
      </div>
      <div className="range-plot">
        {rows.map((lvl) => (
          <div key={lvl} className="range-row">
            <div className="range-label">{SENIORITY_LABEL[lvl]}</div>
            <div className="range-track">
              {ticks(max).map((t) => (
                <span key={t} className="grid" style={{ left: x(t) }} />
              ))}
              {minMonthly ? <span className="min-line" style={{ left: x(minMonthly) }} /> : null}
              {contracts.map((c, i) => {
                const b = bands.find((s) => s.contract === c && s.seniority === lvl);
                if (!b) return null;
                return (
                  <div key={c} className={`range s-${c}`} style={{ top: `${8 + i * 18}px` }}>
                    <span className="bar" style={{ left: x(b.p25), width: `calc(${x(b.p75 - b.p25)} + 0px)` }} />
                    <span className="dot" style={{ left: x(b.median) }} />
                    <span className="val" style={{ left: x(b.p75) }}>
                      {k(b.median)}
                    </span>
                    <span className="hit" style={{ left: x(b.p25), width: x(Math.max(b.p75 - b.p25, max * 0.02)) }}>
                      <span className="tip">
                        <b>
                          {SENIORITY_LABEL[lvl]} · {CONTRACT_NAME[c]}
                        </b>
                        <br />
                        mediana {k(b.median)} / mies.
                        <br />
                        połowa ofert: {k(b.p25)}–{k(b.p75)}
                        <br />
                        {b.n} ofert
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="range-row axis">
          <div className="range-label" />
          <div className="range-track">
            {ticks(max).map((t) => (
              <span key={t} className="tick" style={{ left: x(t) }}>
                {t === 0 ? "0" : k(t)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Ranked bars; the skills missing from the CV carry the accent, the ones the user has recede. */
function SkillsChart({ skills, total }: { skills: Insights["skills"]; total: number }) {
  const max = Math.max(1, ...skills.map((s) => s.count));
  return (
    <section className="panel">
      <h2>Najczęściej wymagane technologie</h2>
      <div className="legend">
        <span>
          <i className="swatch s-accent" /> brak w CV – warto doszlifować
        </span>
        <span>
          <i className="swatch s-muted" /> ✓ masz w CV
        </span>
      </div>
      <div className="hbars">
        {skills.map((s) => (
          <div key={s.name} className={`hbar${s.inCv ? " have" : ""}`}>
            <span className="hbar-label">
              {s.inCv && "✓ "}
              {s.name}
            </span>
            <span className="hbar-track">
              <span className="hbar-fill" style={{ width: `${(s.count / max) * 100}%` }} />
            </span>
            <span className="hbar-val">{pct(s.share)}</span>
            <span className="tip">
              <b>{s.name}</b>
              <br />w {s.count} z {total} ofert ({pct(s.share)})
              <br />
              {s.inCv ? "jest w Twoim CV / profilu" : "nie ma go w CV ani w profilu"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function GapsChart({ gaps }: { gaps: Insights["gaps"] }) {
  const max = Math.max(1, ...gaps.map((g) => g.count));
  return (
    <section className="panel">
      <h2>Czego najczęściej brakuje</h2>
      <p className="hint">Braki, które Claude wskazał w ocenach dopasowania (co najmniej 2 razy).</p>
      {gaps.length ? (
        <div className="hbars">
          {gaps.map((g) => (
            <div key={g.text} className="hbar">
              <span className="hbar-label">{g.text}</span>
              <span className="hbar-track">
                <span className="hbar-fill" style={{ width: `${(g.count / max) * 100}%` }} />
              </span>
              <span className="hbar-val">{g.count}×</span>
              <span className="tip">
                <b>{g.text}</b>
                <br />
                brak w {g.count} ocenionych ofertach
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">Za mało ocen – poproś Claude o ocenę nowych ofert.</p>
      )}
    </section>
  );
}

/** The user's own funnel: ordinal bars with the conversion from the previous stage, and applications per week. */
function FunnelSection({ funnel }: { funnel: Funnel }) {
  const applied = funnel.stages.find((s) => s.key === "applied")!.count;
  if (!funnel.stages[0].count) {
    return (
      <section className="panel">
        <h2>Twój lejek</h2>
        <p className="muted">Pojawi się, gdy zaczniesz oznaczać oferty jako Ciekawe i wysyłać aplikacje.</p>
      </section>
    );
  }
  const max = Math.max(1, ...funnel.stages.map((s) => s.count));
  const weekMax = Math.max(1, ...funnel.weekly.map((w) => w.applied));
  return (
    <section className="panel">
      <h2>Twój lejek</h2>
      <p className="hint">
        {applied
          ? `Odpowiedź na ${pct(funnel.responseRate ?? 0)} aplikacji, rozmowa po ${pct(funnel.interviewRate ?? 0)}` +
            (funnel.medianDaysToAnswer != null ? `, firmy odpisują zwykle po ${funnel.medianDaysToAnswer} dniach` : "") +
            (funnel.noAnswer ? ` · ${funnel.noAnswer} bez odpowiedzi od ponad 14 dni` : "") +
            "."
          : "Jeszcze nie wysłano aplikacji."}
      </p>
      <div className="viz-two tight">
        <div className="hbars funnel">
          {funnel.stages.map((s, i) => {
            const prev = i ? funnel.stages[i - 1].count : 0;
            return (
              <div key={s.key} className="hbar">
                <span className="hbar-label">{s.label}</span>
                <span className="hbar-track">
                  <span className="hbar-fill" style={{ width: `${(s.count / max) * 100}%`, opacity: 1 - i * 0.12 }} />
                </span>
                <span className="hbar-val">{s.count}</span>
                <span className="tip">
                  <b>{s.label}</b>: {s.count}
                  {i > 0 && prev > 0 && (
                    <>
                      <br />
                      {pct(s.count / prev)} z etapu „{funnel.stages[i - 1].label}”
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <div>
          <div className="cols">
            {funnel.weekly.map((w) => (
              <div key={w.week} className="col">
                <span className="col-val">{w.applied || ""}</span>
                <span className="col-bar" style={{ height: `${(w.applied / weekMax) * 100}%` }} />
                <span className="col-label">{w.week.slice(8, 10)}.{w.week.slice(5, 7)}</span>
                <span className="tip">
                  Tydzień od {w.week}: {w.applied} {w.applied === 1 ? "aplikacja" : "aplikacji"}
                </span>
              </div>
            ))}
          </div>
          <div className="muted small" style={{ textAlign: "center", marginTop: 4 }}>
            Wysłane aplikacje w tygodniu (ostatnie 8 tygodni)
          </div>
        </div>
      </div>
    </section>
  );
}

/** Claude's plan: the recurring gaps worth closing, each with a small project that proves it in the CV. */
function LearningSection({ plan, hasGaps, onChange }: { plan: LearningPlan | null; hasGaps: boolean; onChange: (p: LearningPlan) => void }) {
  const [error, setError] = useState<string>();
  const toggle = async (skill: string, done: boolean) => {
    try {
      const r = await api<{ plan: LearningPlan }>("/api/learning", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skill, done }) });
      onChange(r.plan);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!plan?.items.length) {
    return (
      <section className="panel">
        <h2>Plan nauki</h2>
        <p className="muted">
          {hasGaps ? (
            <>
              Napisz w Claude: <i>„zrób plan nauki z braków w Tropicielu”</i>. Wybierze 3–5 najczęstszych braków i do każdego zaproponuje mały projekt, który pokażesz w CV, oraz sprawdzone materiały.
            </>
          ) : (
            "Plan powstanie z braków, które Claude wskaże w ocenach ofert – najpierw poproś o ocenę nowych ofert."
          )}
        </p>
      </section>
    );
  }
  const done = plan.items.filter((i) => i.done).length;
  return (
    <section className="panel">
      <h2>Plan nauki</h2>
      <p className="hint">
        {done}/{plan.items.length} zrobione · plan z {ago(plan.createdAt)}
        {plan.basedOn && ` · na podstawie: ${plan.basedOn}`}. Gdy skończysz projekt, dopisz go do CV – Claude uwzględni go w kolejnych ocenach.
      </p>
      <ol className="learn">
        {plan.items.map((i) => (
          <li key={i.skill} className={i.done ? "done" : ""}>
            <label className="learn-head">
              <input type="checkbox" checked={!!i.done} onChange={(e) => toggle(i.skill, e.target.checked)} />
              <b>{i.skill}</b>
              {i.effort && <span className="chip">{i.effort}</span>}
            </label>
            <p className="muted small">{i.why}</p>
            <p>
              <span className="learn-label">Projekt:</span> {i.project}
            </p>
            {i.resources.length > 0 && (
              <div className="small sources">
                {i.resources.map((r) => (
                  <a key={r.url} href={r.url} target="_blank" rel="noreferrer">
                    {r.title} ↗
                  </a>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
      {error && <p className="error small">{error}</p>}
    </section>
  );
}
