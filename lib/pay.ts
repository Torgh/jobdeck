/**
 * "Na rękę": what is left each month from an employment contract (UoP, gross) or a B2B invoice
 * (net of VAT), under Polish rules for 2026. Annual calculation (thresholds and limits are yearly),
 * shown as a monthly average. Simplified on purpose: no reliefs (ulga dla młodych, IP Box…), no PPK,
 * no joint filing, steady income all year.
 *
 * Sources (checked 2026-11): zus.pl – minimalne i przeciętne wynagrodzenie, składka zdrowotna 2026;
 * podatki.gov.pl / ustawa o PIT – skala 12/32 %, kwota wolna 30 000 zł; infakt.pl, ifirma.pl – limity 2026.
 */

export const PL_2026 = {
  year: 2026,
  minWage: 4806,
  /** Prognozowane przeciętne wynagrodzenie: the 30× cap and the full ZUS base derive from it. */
  forecastAvgWage: 9420,
  /** Annual cap of the pension and disability contribution base (30 × forecast average wage). */
  limit30: 282_600,
  employee: { pension: 0.0976, disability: 0.015, sickness: 0.0245, health: 0.09, kupMonthly: 250, kupMonthlyCommuting: 300 },
  pit: { threshold: 120_000, low: 0.12, high: 0.32, reducing: 3600, flat: 0.19 },
  zus: {
    /** 60 % of the forecast average wage. */
    fullBase: 5652,
    /** 30 % of the minimum wage (first 24 months after "ulga na start"). */
    preferentialBase: 1441.8,
    pension: 0.1952,
    disability: 0.08,
    accident: 0.0167,
    sickness: 0.0245,
    labourFund: 0.0245,
  },
  health: {
    scaleRate: 0.09,
    flatRate: 0.049,
    /** Minimum monthly health contribution on the scale and the flat tax (9 % of the minimum wage). */
    minMonthly: 432.54,
    /** Annual limit of the health contribution deductible on the flat tax. */
    flatDeductionLimit: 14_100,
    /** Ryczałt: monthly contribution by annual revenue (≤ 60 000, ≤ 300 000, more). */
    ryczaltTiers: [
      { upTo: 60_000, monthly: 498.35 },
      { upTo: 300_000, monthly: 830.58 },
      { upTo: Infinity, monthly: 1495.04 },
    ],
  },
  /** Working days in a year when a monthly rate is 168 h (12 × 21). */
  workingDays: 252,
} as const;

export type TaxForm = "ryczalt" | "liniowy" | "skala";
export type ZusVariant = "full" | "preferential" | "start";

export const TAX_FORM_LABEL: Record<TaxForm, string> = { ryczalt: "Ryczałt", liniowy: "Liniowy 19%", skala: "Skala 12/32%" };
export const ZUS_LABEL: Record<ZusVariant, string> = {
  full: "Pełny ZUS",
  preferential: "Preferencyjny (2 lata)",
  start: "Ulga na start (6 mies.)",
};

export interface B2bSettings {
  form: TaxForm;
  /** Ryczałt rate: 12 % for programming, 8.5 % only for some IT services. */
  ryczaltRate: number;
  zus: ZusVariant;
  /** Voluntary sickness insurance (needed for sick pay on B2B). */
  sickness: boolean;
  /** Business costs per month (accounting, equipment…), net. */
  costsMonthly: number;
  /** Days a year without pay (holidays, sick days) – a B2B rate is only paid for days worked. */
  unpaidDays: number;
}

export const DEFAULT_B2B: B2bSettings = { form: "ryczalt", ryczaltRate: 12, zus: "full", sickness: false, costsMonthly: 300, unpaidDays: 0 };

export interface PayResult {
  /** Average per month. */
  net: number;
  /** Per-month averages of what goes where. */
  parts: { label: string; amount: number }[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function pitScale(base: number): number {
  const { threshold, low, high, reducing } = PL_2026.pit;
  if (base <= 0) return 0;
  if (base <= threshold) return Math.max(0, base * low - reducing);
  return threshold * low - reducing + (base - threshold) * high;
}

/** Employment contract (umowa o pracę): monthly gross → monthly net. */
export function uopNet(grossMonthly: number, opts: { commuting?: boolean } = {}): PayResult {
  const e = PL_2026.employee;
  const gross = grossMonthly * 12;
  const capped = Math.min(gross, PL_2026.limit30);
  const social = capped * (e.pension + e.disability) + gross * e.sickness;
  const health = (gross - social) * e.health;
  const kup = (opts.commuting ? e.kupMonthlyCommuting : e.kupMonthly) * 12;
  const tax = Math.round(pitScale(Math.round(gross - social - kup)));
  const net = gross - social - health - tax;
  return {
    net: r2(net / 12),
    parts: [
      { label: "ZUS (emerytalna, rentowa, chorobowa)", amount: r2(social / 12) },
      { label: "Składka zdrowotna", amount: r2(health / 12) },
      { label: "Podatek PIT", amount: r2(tax / 12) },
    ],
  };
}

/** B2B: monthly invoice (net of VAT) → monthly on hand, for the chosen tax form and ZUS. */
export function b2bNet(invoiceMonthly: number, s: B2bSettings = DEFAULT_B2B): PayResult {
  const z = PL_2026.zus;
  const h = PL_2026.health;
  const revenue = invoiceMonthly * 12 * ((PL_2026.workingDays - Math.min(s.unpaidDays, PL_2026.workingDays)) / PL_2026.workingDays);
  const costs = s.costsMonthly * 12;
  const base = s.zus === "full" ? z.fullBase : s.zus === "preferential" ? z.preferentialBase : 0;
  const social = base * (z.pension + z.disability + z.accident + (s.sickness ? z.sickness : 0)) * 12;
  // Fundusz Pracy only on the full base; it is a business cost (not deductible on ryczałt).
  const labourFund = s.zus === "full" ? base * z.labourFund * 12 : 0;

  let health: number;
  let tax: number;
  if (s.form === "ryczalt") {
    const tier = h.ryczaltTiers.find((t) => revenue <= t.upTo)!;
    health = tier.monthly * 12;
    tax = Math.round(Math.max(0, revenue - social - health / 2) * (s.ryczaltRate / 100));
  } else {
    const income = Math.max(0, revenue - costs - labourFund - social);
    if (s.form === "liniowy") {
      health = Math.max(income * h.flatRate, h.minMonthly * 12);
      tax = Math.round(Math.max(0, income - Math.min(health, h.flatDeductionLimit)) * PL_2026.pit.flat);
    } else {
      health = Math.max(income * h.scaleRate, h.minMonthly * 12);
      tax = Math.round(pitScale(Math.round(income)));
    }
  }
  const net = revenue - costs - labourFund - social - health - tax;
  const parts = [
    { label: "ZUS społeczny" + (labourFund ? " + Fundusz Pracy" : ""), amount: r2((social + labourFund) / 12) },
    { label: "Składka zdrowotna", amount: r2(health / 12) },
    { label: `Podatek (${s.form === "ryczalt" ? `ryczałt ${s.ryczaltRate}%` : TAX_FORM_LABEL[s.form]})`, amount: r2(tax / 12) },
    { label: "Koszty firmy", amount: r2(costs / 12) },
  ];
  if (s.unpaidDays > 0) parts.push({ label: `Bez wynagrodzenia: ${s.unpaidDays} dni w roku`, amount: r2(invoiceMonthly - revenue / 12) });
  return { net: r2(net / 12), parts };
}

/** The invoice that leaves as much on hand as a given UoP gross (what to ask for when switching to B2B). */
export function b2bEquivalent(uopGrossMonthly: number, s: B2bSettings = DEFAULT_B2B): number {
  const target = uopNet(uopGrossMonthly).net;
  let lo = 0;
  let hi = Math.max(10_000, uopGrossMonthly * 3);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (b2bNet(mid, s).net < target) lo = mid;
    else hi = mid;
  }
  return Math.ceil(hi / 10) * 10;
}

/** On-hand range of one salary from an offer (monthly PLN), or undefined when it cannot be estimated. */
export function onHandRange(
  salary: { contract?: string; gross?: boolean; monthlyPln?: { min?: number; max?: number } },
  s: B2bSettings = DEFAULT_B2B,
): { min?: number; max?: number } | undefined {
  const m = salary.monthlyPln;
  if (!m || (m.min == null && m.max == null)) return undefined;
  const f =
    salary.contract === "b2b"
      ? (v: number) => b2bNet(v, s).net
      : salary.contract === "uop" && salary.gross !== false
        ? (v: number) => uopNet(v).net
        : undefined;
  if (!f) return undefined;
  return { min: m.min != null ? Math.round(f(m.min)) : undefined, max: m.max != null ? Math.round(f(m.max)) : undefined };
}

/** The user's B2B settings from the profile, completed with defaults. */
export function paySettings(pay?: Partial<B2bSettings>): B2bSettings {
  return { ...DEFAULT_B2B, ...Object.fromEntries(Object.entries(pay ?? {}).filter(([, v]) => v != null)) };
}

/** The best "na rękę" an offer can mean (top of the best range), for sorting. */
export function bestOnHand(salaries: { contract?: string; gross?: boolean; monthlyPln?: { min?: number; max?: number } }[], s: B2bSettings): number | undefined {
  let best: number | undefined;
  for (const sal of salaries) {
    const r = onHandRange(sal, s);
    const top = r?.max ?? r?.min;
    if (top != null && (best == null || top > best)) best = top;
  }
  return best;
}

/** "≈ 14,9–17,3k na rękę" */
export function formatOnHand(r: { min?: number; max?: number }): string {
  const k = (v: number) => `${(v / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })}k`;
  if (r.min != null && r.max != null && Math.abs(r.max - r.min) >= 100) return `≈ ${k(r.min)}–${k(r.max)} na rękę`;
  const v = r.min ?? r.max;
  return v == null ? "" : `≈ ${k(v)} na rękę`;
}
