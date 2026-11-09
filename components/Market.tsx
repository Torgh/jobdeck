"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Insights, SalaryBand } from "@/lib/insights";
import { SENIORITY_LABEL, SOURCE_LABEL, type Seniority } from "@/lib/types";
import { api } from "./api";

const k = (v: number) => `${(v / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })}k`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

const CONTRACT_NAME = { b2b: "B2B netto", uop: "UoP brutto" } as const;

/** What the collected offers say: salaries by level, skills in demand, recurring gaps, sources. */
export function Market() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<{ insights: Insights; minMonthlyPln: number | null }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    api<{ insights: Insights; minMonthlyPln: number | null }>(`/api/insights?days=${days}`)
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
      <header className="topbar">
        <Link href="/" className="brand">
          <img src="/icon.svg" alt="" width={24} height={24} />
          Job<span>Deck</span>
        </Link>
        <span className="muted">Rynek</span>
        <span className="spacer" />
        <Link className="btn" href="/">
          ← Wróć
        </Link>
      </header>
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
          <span className="muted small">Z ofert zebranych przez JobDeck (Twoje frazy i filtry) – nie cały rynek.</span>
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

            <SalaryChart bands={ins.salary} minMonthly={data.minMonthlyPln} />

            <div className="viz-two">
              <SkillsChart skills={ins.skills.slice(0, 15)} total={ins.total} />
              <GapsChart gaps={ins.gaps} />
            </div>

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
              Poziomy z co najmniej 3 ofertami. Szczegółową interpretację da Claude: <i>„co mówi rynek w JobDeck?”</i>
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
