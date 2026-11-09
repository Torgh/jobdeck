"use client";

import { useEffect, useState } from "react";
import { b2bEquivalent, b2bNet, paySettings, PL_2026, TAX_FORM_LABEL, uopNet, ZUS_LABEL, type B2bSettings, type PayResult, type TaxForm, type ZusVariant } from "@/lib/pay";
import type { ProfileView } from "@/lib/view";
import { api } from "./api";
import { TopNav } from "./Nav";

const zl = (v: number) => `${Math.round(v).toLocaleString("pl-PL")} zł`;

function Breakdown({ title, gross, grossLabel, result, highlight }: { title: string; gross: number; grossLabel: string; result: PayResult; highlight?: boolean }) {
  return (
    <div className={`calc-card${highlight ? " best" : ""}`}>
      <h3>{title}</h3>
      <div className="calc-net">
        {zl(result.net)}
        <span className="muted small"> / mies. na rękę</span>
      </div>
      <dl className="calc-parts">
        <dt>{grossLabel}</dt>
        <dd>{zl(gross)}</dd>
        {result.parts
          .filter((p) => p.amount > 0)
          .map((p) => (
            <div key={p.label} className="calc-row">
              <dt>{p.label}</dt>
              <dd>− {zl(p.amount)}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

/** UoP vs B2B side by side, with the user's B2B settings (saved in the profile for the offers' estimates). */
export function Calculator() {
  const [uop, setUop] = useState(15_000);
  const [b2b, setB2b] = useState(20_000);
  const [commuting, setCommuting] = useState(false);
  const [s, setS] = useState<B2bSettings>(paySettings());
  const [saved, setSaved] = useState<string>();

  useEffect(() => {
    api<ProfileView>("/api/profile")
      .then((p) => {
        setS(paySettings(p.pay));
        setCommuting(!!p.pay?.commuting);
      })
      .catch(() => undefined);
  }, []);

  const set = <K extends keyof B2bSettings>(k: K, v: B2bSettings[K]) => {
    setS((old) => ({ ...old, [k]: v }));
    setSaved(undefined);
  };

  const save = async () => {
    await api("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pay: { ...s, commuting } }) });
    setSaved("Zapisano – oferty pokazują teraz „na rękę” według tych ustawień.");
  };

  const uopRes = uopNet(uop, { commuting });
  const forms: TaxForm[] = ["ryczalt", "liniowy", "skala"];
  const b2bRes = forms.map((f) => ({ f, r: b2bNet(b2b, { ...s, form: f }) }));
  const bestForm = b2bRes.reduce((a, b) => (b.r.net > a.r.net ? b : a)).f;
  const equivalent = b2bEquivalent(uop, s);

  return (
    <>
      <TopNav active="calculator" />
      <div className="page wide">
        <div className="panel">
          <div className="calc-inputs">
            <label className="field">
              <span>UoP – brutto miesięcznie</span>
              <input type="number" min={0} step={500} value={uop} onChange={(e) => setUop(Number(e.target.value) || 0)} />
            </label>
            <label className="field">
              <span>B2B – faktura netto (bez VAT) miesięcznie</span>
              <input type="number" min={0} step={500} value={b2b} onChange={(e) => setB2b(Number(e.target.value) || 0)} />
              <small className="muted">Stawka godzinowa × 168 h. Np. 120 zł/h = {zl(120 * 168)}.</small>
            </label>
          </div>
          <div className="calc-hint">
            Żeby na B2B mieć tyle co na UoP z {zl(uop)} brutto ({zl(uopRes.net)} na rękę), faktura musi wynosić ok. <b>{zl(equivalent)}</b> netto
            <span className="muted"> ({TAX_FORM_LABEL[s.form]}{s.form === "ryczalt" ? ` ${s.ryczaltRate}%` : ""}, {ZUS_LABEL[s.zus]}).</span>
            <button className="btn small" onClick={() => setB2b(equivalent)}>
              Wstaw
            </button>
          </div>
        </div>

        <div className="calc-grid">
          <Breakdown title="Umowa o pracę" gross={uop} grossLabel="Brutto" result={uopRes} />
          {b2bRes.map(({ f, r }) => (
            <Breakdown
              key={f}
              title={`B2B · ${f === "ryczalt" ? `Ryczałt ${s.ryczaltRate}%` : TAX_FORM_LABEL[f]}`}
              gross={b2b}
              grossLabel="Faktura netto"
              result={r}
              highlight={f === bestForm}
            />
          ))}
        </div>

        <div className="panel">
          <h2>Twoje ustawienia B2B</h2>
          <p className="hint">Według nich oferty na tablicy pokazują kwotę „na rękę”.</p>
          <div className="calc-settings">
            <label className="field">
              <span>Forma opodatkowania</span>
              <select value={s.form} onChange={(e) => set("form", e.target.value as TaxForm)}>
                {forms.map((f) => (
                  <option key={f} value={f}>
                    {TAX_FORM_LABEL[f]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Stawka ryczałtu</span>
              <select value={s.ryczaltRate} onChange={(e) => set("ryczaltRate", Number(e.target.value))} disabled={s.form !== "ryczalt"}>
                <option value={12}>12% – programowanie</option>
                <option value={8.5}>8,5% – niektóre usługi IT</option>
              </select>
            </label>
            <label className="field">
              <span>ZUS</span>
              <select value={s.zus} onChange={(e) => set("zus", e.target.value as ZusVariant)}>
                {(Object.keys(ZUS_LABEL) as ZusVariant[]).map((z) => (
                  <option key={z} value={z}>
                    {ZUS_LABEL[z]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Koszty firmy / mies. (netto)</span>
              <input type="number" min={0} step={50} value={s.costsMonthly} onChange={(e) => set("costsMonthly", Number(e.target.value) || 0)} />
            </label>
            <label className="field">
              <span>Dni bez wynagrodzenia w roku</span>
              <input type="number" min={0} max={120} value={s.unpaidDays} onChange={(e) => set("unpaidDays", Number(e.target.value) || 0)} />
              <small className="muted">Urlop i choroba na B2B są zwykle niepłatne (na UoP: 20–26 dni płatnego urlopu).</small>
            </label>
            <div className="field">
              <span>Opcje</span>
              <label className="check-line">
                <input type="checkbox" checked={s.sickness} onChange={(e) => set("sickness", e.target.checked)} /> dobrowolne chorobowe (B2B)
              </label>
              <label className="check-line">
                <input type="checkbox" checked={commuting} onChange={(e) => (setCommuting(e.target.checked), setSaved(undefined))} /> dojazd z innej miejscowości (UoP)
              </label>
            </div>
          </div>
          <div className="actions-row">
            <button className="btn primary" onClick={save}>
              Zapisz jako moje ustawienia
            </button>
            {saved && <span className="ok small">{saved}</span>}
          </div>
        </div>

        <p className="muted small disclaimer">
          Szacunek według przepisów na {PL_2026.year} r.: płaca minimalna {zl(PL_2026.minWage)}, limit 30-krotności {zl(PL_2026.limit30)}, pełny ZUS od {zl(PL_2026.zus.fullBase)},
          zdrowotna na ryczałcie {PL_2026.health.ryczaltTiers.map((t) => zl(t.monthly)).join(" / ")}. Liczone rocznie, bez ulg (np. dla młodych, IP Box), PPK i
          wspólnego rozliczenia. Przed decyzją sprawdź z księgową.
        </p>
      </div>
    </>
  );
}
