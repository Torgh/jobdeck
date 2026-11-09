import type { Contract, Period, Salary } from "./types";

/** Working hours / days in a month, as Polish portals count them. */
const PER_MONTH: Record<Period, number> = { hour: 168, day: 21, month: 1, year: 1 / 12 };

/** PLN per unit; filled from NBP at scan time, these are fallbacks. */
export const FALLBACK_RATES: Record<string, number> = { PLN: 1, EUR: 4.25, USD: 3.7, GBP: 4.9, CHF: 4.55 };

export function currencyCode(raw: string | undefined): string {
  const c = (raw ?? "").trim().toUpperCase();
  if (c === "ZŁ" || c === "ZL" || c === "PLN" || c === "") return "PLN";
  if (c === "€") return "EUR";
  if (c === "$") return "USD";
  if (c === "£") return "GBP";
  return c;
}

export function normalizeSalary(s: Salary, rates: Record<string, number> = FALLBACK_RATES): Salary {
  const rate = rates[currencyCode(s.currency)];
  if (!rate) return { ...s, currency: currencyCode(s.currency) };
  const k = PER_MONTH[s.period] * rate;
  const round = (v?: number) => (v == null ? undefined : Math.round((v * k) / 100) * 100);
  return { ...s, currency: currencyCode(s.currency), monthlyPln: { min: round(s.min), max: round(s.max) } };
}

const PERIOD_SHORT: Record<Period, string> = { hour: "/h", day: "/dzień", month: "/mies.", year: "/rok" };

function k(v: number): string {
  if (v >= 1000) return `${(v / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })}k`;
  return v.toLocaleString("pl-PL");
}

export function contractTag(c?: Contract, gross?: boolean): string {
  if (c === "b2b") return "B2B";
  if (c === "uop") return gross === false ? "UoP netto" : "UoP";
  if (c === "uz") return "UZ";
  return "";
}

/** "20–25k PLN/mies. B2B", with "(≈ 27–32k/mies.)" for hourly or foreign rates. */
export function formatSalary(s: Salary): string {
  const range =
    s.min != null && s.max != null && s.min !== s.max
      ? `${k(s.min)}–${k(s.max)}`
      : s.min != null
        ? `od ${k(s.min)}`
        : s.max != null
          ? `do ${k(s.max)}`
          : "?";
  let out = `${range} ${s.currency}${PERIOD_SHORT[s.period]}`;
  const m = s.monthlyPln;
  if (m && (s.period !== "month" || s.currency !== "PLN") && (m.min || m.max)) {
    const mr = m.min && m.max && m.min !== m.max ? `${k(m.min)}–${k(m.max)}` : k((m.min || m.max)!);
    out += ` (≈ ${mr} PLN/mies.)`;
  }
  const tag = contractTag(s.contract, s.gross);
  return tag ? `${out} ${tag}` : out;
}

/** The best monthly PLN range across an offer's contracts. */
export function bestMonthly(salaries: Salary[]): { min?: number; max?: number } | undefined {
  let best: { min?: number; max?: number } | undefined;
  for (const s of salaries) {
    const m = s.monthlyPln;
    if (!m || (m.min == null && m.max == null)) continue;
    if (!best || (m.max ?? m.min ?? 0) > (best.max ?? best.min ?? 0)) best = m;
  }
  return best;
}

/**
 * Parses salary text the way Polish portals print it:
 * "160–230 zł netto (+ VAT) / godz.", "15 000 - 20 000 PLN brutto / mies.", "25 000 zł brutto / mies."
 */
export function parseSalaryText(text: string, contractHint?: Contract): Salary | undefined {
  const t = text.replace(/ | /g, " ").toLowerCase();
  const nums = [...t.matchAll(/(\d[\d\s]*(?:[.,]\d+)?)/g)]
    .map((m) => Number(m[1].replace(/\s/g, "").replace(",", ".")))
    .filter((n) => n > 0);
  if (!nums.length) return undefined;
  const period: Period = /godz|\/ ?h\b|hour|hr\./.test(t)
    ? "hour"
    : /dzie|day/.test(t)
      ? "day"
      : /rok|year|annual/.test(t)
        ? "year"
        : "month";
  const currency = /€|eur/.test(t) ? "EUR" : /\$|usd/.test(t) ? "USD" : /£|gbp/.test(t) ? "GBP" : "PLN";
  const gross = /brutto|gross/.test(t) ? true : /netto|net\b/.test(t) ? false : undefined;
  const contract: Contract | undefined = /vat|b2b/.test(t) ? "b2b" : contractHint;
  return { min: nums[0], max: nums[1] ?? nums[0], currency, period, gross, contract };
}
