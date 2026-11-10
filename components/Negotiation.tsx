"use client";

import { useEffect, useState } from "react";
import { negotiation, POSITION_LABEL, type Insights } from "@/lib/insights";
import { b2bEquivalent, b2bNet, uopNet, type B2bSettings } from "@/lib/pay";
import type { Job } from "@/lib/types";
import { api, type JobUpdate } from "./api";

type Market = { bands: Insights["salary"]; minMonthly?: number };

/** Salary bands over a longer window than the Market page default: more offers per level. */
let market: Promise<Market> | undefined;
function loadMarket(): Promise<Market> {
  market ??= api<{ insights: Insights; minMonthlyPln: number | null }>("/api/insights?days=180")
    .then((r) => ({ bands: r.insights.salary, minMonthly: r.minMonthlyPln ?? undefined }))
    .catch((e) => {
      market = undefined;
      throw e;
    });
  return market;
}

const zl = (v: number) => `${Math.round(v).toLocaleString("pl-PL")} zł`;
const k = (v: number) => `${(v / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })}k`;
const NAME = { b2b: "B2B netto", uop: "UoP brutto" } as const;

/** Interview / offer stage: what the company proposed against its own range, the market and the user's minimum. */
export function NegotiationBox({ job, pay, onUpdate }: { job: Job; pay: B2bSettings; onUpdate: (patch: JobUpdate) => void }) {
  const [data, setData] = useState<Market>();
  const [error, setError] = useState<string>();
  const [amount, setAmount] = useState(job.offered ? String(job.offered.monthly) : "");
  const [contract, setContract] = useState<"b2b" | "uop">(job.offered?.contract ?? (job.salaries.find((s) => s.contract === "uop") && !job.salaries.find((s) => s.contract === "b2b") ? "uop" : "b2b"));

  useEffect(() => {
    let alive = true;
    loadMarket()
      .then((m) => alive && setData(m))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  const save = () => {
    const v = Number(amount.replace(/\s/g, "").replace(",", "."));
    const offered = v > 0 ? { monthly: v, contract } : null;
    if (offered?.monthly === job.offered?.monthly && offered?.contract === job.offered?.contract) return;
    if (!offered && !job.offered) return;
    onUpdate({ offered });
  };

  const rows = data ? negotiation(job, data.bands, { minMonthly: data.minMonthly }) : [];
  const net = (v: number, c: "b2b" | "uop") => (c === "b2b" ? b2bNet(v, pay).net : uopNet(v).net);

  return (
    <section className="box negotiation">
      <h3>Negocjacje</h3>
      <div className="nego-input">
        <label className="small muted" htmlFor={`offered-${job.id}`}>
          Propozycja firmy (mies.)
        </label>
        <input id={`offered-${job.id}`} type="text" inputMode="numeric" placeholder="np. 22000" value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} />
        <select
          value={contract}
          onChange={(e) => {
            const c = e.target.value as "b2b" | "uop";
            setContract(c);
            if (job.offered) onUpdate({ offered: { ...job.offered, contract: c } });
          }}
          aria-label="Umowa"
        >
          <option value="b2b">B2B netto</option>
          <option value="uop">UoP brutto</option>
        </select>
      </div>
      {error ? (
        <p className="error small">{error}</p>
      ) : !data ? (
        <p className="muted small">Wczytuję dane rynku…</p>
      ) : !rows.length ? (
        <p className="muted small">Brak widełek w ofercie i za mało ofert z widełkami, by porównać z rynkiem. Wpisz propozycję firmy albo zbierz więcej ofert.</p>
      ) : (
        rows.map((n) => (
          <div key={n.contract} className="nego">
            <table className="nego-table small">
              <tbody>
                {n.offered != null && (
                  <tr>
                    <td>Propozycja firmy</td>
                    <td>
                      <b>{k(n.offered)}</b> <span className="muted">≈ {k(net(n.offered, n.contract))} na rękę</span>
                    </td>
                  </tr>
                )}
                {n.range && (
                  <tr>
                    <td>Widełki w ogłoszeniu</td>
                    <td>
                      {n.range.min != null ? k(n.range.min) : "?"}–{n.range.max != null ? k(n.range.max) : "?"}
                    </td>
                  </tr>
                )}
                {n.band && (
                  <tr>
                    <td>Rynek ({n.band.seniority === "all" ? "wszystkie poziomy" : n.band.seniority})</td>
                    <td>
                      mediana {k(n.band.median)} · połowa ofert {k(n.band.p25)}–{k(n.band.p75)} <span className="muted">(n={n.band.n})</span>
                    </td>
                  </tr>
                )}
                {data.minMonthly && (
                  <tr>
                    <td>Twoje minimum</td>
                    <td>{k(data.minMonthly)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {n.position && <p className="small">Propozycja / widełki firmy: <b>{POSITION_LABEL[n.position]}</b>.</p>}
            <p className="nego-ask">
              Proponuję poprosić o <b>{zl(n.ask)}</b> {NAME[n.contract]} <span className="muted">(≈ {zl(net(n.ask, n.contract))} na rękę)</span>
            </p>
            {n.contract === "uop" && <p className="muted small">Ta kwota na UoP to mniej więcej faktura B2B {zl(b2bEquivalent(n.ask, pay))} netto przy Twoich ustawieniach.</p>}
            {n.reasons.length > 0 && (
              <ul className="pc">
                {n.reasons.map((r) => (
                  <li key={r} className="pro">
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}
      <p className="muted small">
        Liczby tylko z ofert zebranych przez Tropiciela (180 dni). Pełny plan rozmowy, argumenty z Twojego CV i odpowiedź na „ile Pan/Pani oczekuje?” przygotuje Claude: <i>„pomóż mi negocjować ofertę {job.id}”</i>.
      </p>
    </section>
  );
}
