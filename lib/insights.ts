import { fold, matchedSkills, type SkillSource } from "./jobs";
import { SENIORITIES, SOURCES, type Contract, type Job, type Seniority, type SourceId } from "./types";

/** What the collected offers say about the market for the user, over a time window. */
export interface Insights {
  days: number;
  total: number;
  withSalary: number;
  rated: number;
  avgFit?: number;
  /** Monthly PLN (middle of each offer's range): B2B net and UoP gross, by level. */
  salary: SalaryBand[];
  /** Most requested skills, with whether the CV / profile shows them. */
  skills: SkillCount[];
  /** Requirements Claude most often listed as missing in the ratings. */
  gaps: { text: string; count: number }[];
  sources: SourceStats[];
}

export interface SalaryBand {
  contract: Extract<Contract, "b2b" | "uop">;
  seniority: Seniority | "all";
  n: number;
  p25: number;
  median: number;
  p75: number;
}

export interface SkillCount {
  name: string;
  count: number;
  /** Share of the offers in the window that list it. */
  share: number;
  inCv: boolean;
}

export interface SourceStats {
  source: SourceId;
  offers: number;
  rated: number;
  avgFit?: number;
  /** Rated 65 or more. */
  good: number;
  /** Moved on from the inbox (interesting or further, not dismissed). */
  picked: number;
  applied: number;
  interviews: number;
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const round100 = (v: number) => Math.round(v / 100) * 100;

function band(values: number[], contract: SalaryBand["contract"], seniority: SalaryBand["seniority"]): SalaryBand | undefined {
  if (values.length < 3) return undefined;
  const s = [...values].sort((a, b) => a - b);
  return { contract, seniority, n: s.length, p25: round100(quantile(s, 0.25)), median: round100(quantile(s, 0.5)), p75: round100(quantile(s, 0.75)) };
}

/** "AWS – nie widać w CV" / "brak AWS (wymagane)" → "aws" for counting. */
export function gapKey(text: string): string {
  return fold(
    text
      .replace(/\s[–—-]\s.*$/, "")
      .replace(/\(.*?\)/g, "")
      .replace(/^(brak|brakuje|nie widac|słabe|slabe|mało|malo)\s+/i, ""),
  );
}

const APPLIED = new Set(["applied", "interview", "offer"]);

export function computeInsights(jobs: Job[], profile: SkillSource, opts: { days?: number; now?: number } = {}): Insights {
  const days = opts.days ?? 90;
  const now = opts.now ?? Date.now();
  const from = days > 0 ? now - days * 86_400_000 : -Infinity;
  const inWindow = jobs.filter((j) => Date.parse(j.foundAt) >= from);

  // Salaries: the middle of each offer's monthly range, per contract and level.
  const byKey = new Map<string, number[]>();
  for (const j of inWindow) {
    for (const s of j.salaries) {
      const m = s.monthlyPln;
      if (!m || (m.min == null && m.max == null)) continue;
      const contract = s.contract === "b2b" ? "b2b" : s.contract === "uop" && s.gross !== false ? "uop" : undefined;
      if (!contract) continue;
      const mid = m.min != null && m.max != null ? (m.min + m.max) / 2 : (m.min ?? m.max)!;
      for (const lvl of [j.seniority ?? "unknown", "all"]) {
        const k = `${contract}|${lvl}`;
        byKey.set(k, [...(byKey.get(k) ?? []), mid]);
      }
    }
  }
  const salary: SalaryBand[] = [];
  for (const contract of ["b2b", "uop"] as const) {
    for (const lvl of [...SENIORITIES, "all"] as const) {
      const b = band(byKey.get(`${contract}|${lvl}`) ?? [], contract, lvl);
      if (b) salary.push(b);
    }
  }

  // Skills: counted once per offer, named as first seen.
  const counts = new Map<string, { name: string; count: number }>();
  for (const j of inWindow) {
    for (const k of new Set(j.skills.map((s) => fold(s)).filter(Boolean))) {
      const entry = counts.get(k) ?? { name: j.skills.find((s) => fold(s) === k)!, count: 0 };
      entry.count++;
      counts.set(k, entry);
    }
  }
  const all = [...counts.values()].sort((a, b) => b.count - a.count);
  const have = matchedSkills(
    all.map((s) => s.name),
    profile,
  );
  const skills = all.slice(0, 40).map((s) => ({ ...s, share: inWindow.length ? s.count / inWindow.length : 0, inCv: have.has(s.name) }));

  // Gaps from Claude's ratings.
  const gapCounts = new Map<string, { text: string; count: number }>();
  for (const j of inWindow) {
    for (const g of new Set((j.fit?.gaps ?? []).map((t) => t.trim()))) {
      const k = gapKey(g);
      if (!k) continue;
      const e = gapCounts.get(k) ?? { text: g.replace(/\s[–—-]\s.*$/, "").trim(), count: 0 };
      e.count++;
      gapCounts.set(k, e);
    }
  }
  const gaps = [...gapCounts.values()].filter((g) => g.count >= 2).sort((a, b) => b.count - a.count).slice(0, 12);

  const sources: SourceStats[] = SOURCES.map((source) => {
    const js = inWindow.filter((j) => j.links.some((l) => l.source === source));
    const rated = js.filter((j) => j.fit);
    return {
      source,
      offers: js.length,
      rated: rated.length,
      avgFit: rated.length ? Math.round(rated.reduce((a, j) => a + j.fit!.score, 0) / rated.length) : undefined,
      good: rated.filter((j) => j.fit!.score >= 65).length,
      picked: js.filter((j) => j.status !== "new" && !(j.status === "closed" && j.closedReason === "not_for_me")).length,
      applied: js.filter((j) => APPLIED.has(j.status) || !!j.appliedAt).length,
      interviews: js.filter((j) => j.status === "interview" || j.status === "offer" || j.events?.some((e) => e.kind === "interview_invite")).length,
    };
  }).filter((s) => s.offers > 0);

  const ratedAll = inWindow.filter((j) => j.fit);
  return {
    days,
    total: inWindow.length,
    withSalary: inWindow.filter((j) => j.salaries.length).length,
    rated: ratedAll.length,
    avgFit: ratedAll.length ? Math.round(ratedAll.reduce((a, j) => a + j.fit!.score, 0) / ratedAll.length) : undefined,
    salary,
    skills,
    gaps,
    sources,
  };
}

/** The user's application funnel, over everything on the board. */
export interface Funnel {
  stages: { key: "picked" | "applied" | "responded" | "interview" | "offer"; label: string; count: number }[];
  /** Share of sent applications that got any answer. */
  responseRate?: number;
  /** Share of sent applications that led to an interview. */
  interviewRate?: number;
  /** Median days from sending to the first answer. */
  medianDaysToAnswer?: number;
  /** Sent more than 14 days ago, still no answer. */
  noAnswer: number;
  /** Applications sent per week, the last 8 weeks (week = Monday, YYYY-MM-DD). */
  weekly: { week: string; applied: number }[];
}

const ANSWER_KINDS = new Set(["reply", "interview_invite", "task", "rejection", "offer"]);

function monday(ts: number): string {
  const d = new Date(ts);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function computeFunnel(jobs: Job[], now = Date.now()): Funnel {
  const reachedInterview = (j: Job) =>
    j.status === "interview" || j.status === "offer" || !!j.events?.some((e) => e.kind === "interview_invite" || (e.kind === "status" && e.text.endsWith("→ Rozmowy")));
  const gotOffer = (j: Job) => j.status === "offer" || j.closedReason === "accepted" || !!j.events?.some((e) => e.kind === "offer");
  const applied = jobs.filter((j) => !!j.appliedAt || APPLIED.has(j.status));
  const firstAnswer = (j: Job) => j.events?.find((e) => ANSWER_KINDS.has(e.kind))?.at;
  const answered = applied.filter((j) => firstAnswer(j) || reachedInterview(j) || j.closedReason === "rejected");
  const picked = jobs.filter((j) => j.status !== "new" && !(j.status === "closed" && j.closedReason === "not_for_me" && !j.appliedAt));
  const interviews = applied.filter(reachedInterview);
  const offers = applied.filter(gotOffer);

  const waits = applied
    .map((j) => {
      const a = firstAnswer(j);
      return a && j.appliedAt ? (Date.parse(a) - Date.parse(`${j.appliedAt}T00:00:00Z`)) / 86_400_000 : undefined;
    })
    .filter((d): d is number => d != null && d >= 0)
    .sort((a, b) => a - b);

  const weeks = Array.from({ length: 8 }, (_, i) => monday(now - (7 - i) * 7 * 86_400_000));
  const weekly = weeks.map((week) => ({
    week,
    applied: applied.filter((j) => j.appliedAt && monday(Date.parse(`${j.appliedAt}T12:00:00Z`)) === week).length,
  }));

  return {
    stages: [
      { key: "picked", label: "Wybrane", count: picked.length },
      { key: "applied", label: "Wysłane", count: applied.length },
      { key: "responded", label: "Odpowiedź", count: answered.length },
      { key: "interview", label: "Rozmowa", count: interviews.length },
      { key: "offer", label: "Oferta", count: offers.length },
    ],
    responseRate: applied.length ? answered.length / applied.length : undefined,
    interviewRate: applied.length ? interviews.length / applied.length : undefined,
    medianDaysToAnswer: waits.length ? Math.round(quantile(waits, 0.5)) : undefined,
    noAnswer: applied.filter((j) => j.status === "applied" && !firstAnswer(j) && j.appliedAt && now - Date.parse(`${j.appliedAt}T00:00:00Z`) > 14 * 86_400_000).length,
    weekly,
  };
}

/** What to ask for in a salary talk, for one contract type of an offer. */
export interface Negotiation {
  contract: "b2b" | "uop";
  /** The amount the company proposed (job.offered), if the user recorded it. */
  offered?: number;
  /** The offer's published range (monthly PLN). */
  range?: { min?: number; max?: number };
  /** The market for the offer's level (or all levels when there are too few offers at that level). */
  band?: SalaryBand;
  /** Where the company's figure (proposal, else the range top) sits against that market. */
  position?: "below_p25" | "p25_median" | "median_p75" | "above_p75";
  /** Suggested figure to ask for (monthly PLN, rounded up to 500). */
  ask: number;
  /** Polish arguments behind the figure, strongest first. */
  reasons: string[];
}

export const POSITION_LABEL: Record<NonNullable<Negotiation["position"]>, string> = {
  below_p25: "poniżej rynku (dolna ćwiartka)",
  p25_median: "poniżej mediany rynku",
  median_p75: "powyżej mediany rynku",
  above_p75: "w górnej ćwiartce rynku",
};

const up500 = (v: number) => Math.ceil(v / 500) * 500;
const fmtK = (v: number) => `${(v / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })}k`;

/**
 * Arguments and a figure for the salary talk: the offer's own range, what the company proposed,
 * the market for the level from the collected offers, and the user's minimum.
 */
export function negotiation(
  job: Pick<Job, "salaries" | "seniority" | "offered">,
  bands: SalaryBand[],
  opts: { minMonthly?: number } = {},
): Negotiation[] {
  const contracts = new Set<"b2b" | "uop">();
  if (job.offered) contracts.add(job.offered.contract);
  for (const s of job.salaries) {
    if (s.contract === "b2b" || (s.contract === "uop" && s.gross !== false)) contracts.add(s.contract);
  }
  const out: Negotiation[] = [];
  for (const contract of contracts) {
    const sal = job.salaries.find((s) => s.contract === contract && s.monthlyPln && (s.monthlyPln.min != null || s.monthlyPln.max != null));
    const range = sal?.monthlyPln;
    const offered = job.offered?.contract === contract ? job.offered.monthly : undefined;
    const atLevel = job.seniority && bands.find((b) => b.contract === contract && b.seniority === job.seniority);
    const band = atLevel || bands.find((b) => b.contract === contract && b.seniority === "all");
    const base = offered ?? range?.max ?? range?.min;
    if (base == null && !band) continue;
    const what = contract === "b2b" ? "B2B netto" : "UoP brutto";
    const levelName = atLevel ? `poziomu ${job.seniority}` : "wszystkich poziomów";
    const reasons: string[] = [];
    let ask = base ?? band!.median;
    if (base == null && band) {
      ask = Math.max(band.median, (band.median + band.p75) / 2);
      reasons.push(`Oferta nie podaje widełek – rynek ${levelName} (${what}): mediana ${fmtK(band.median)}, górna ćwiartka od ${fmtK(band.p75)} (n=${band.n}). Podaj kwotę między nimi.`);
    }

    if (offered != null && range?.max != null && offered < range.max) {
      ask = Math.max(ask, range.max);
      reasons.push(`Firma sama opublikowała widełki do ${fmtK(range.max)} – propozycja ${fmtK(offered)} jest poniżej ich górnej granicy.`);
    }
    if (band && ask < band.median) {
      ask = band.median;
      reasons.push(`Mediana ofert ${levelName} (${what}) to ${fmtK(band.median)} (n=${band.n}); połowa ofert płaci ${fmtK(band.p25)}–${fmtK(band.p75)}.`);
    }
    if (opts.minMonthly && ask < opts.minMonthly) {
      ask = opts.minMonthly;
      reasons.push(`Twoje minimum to ${fmtK(opts.minMonthly)} – poniżej nie warto schodzić bez innych korzyści.`);
    }
    if (base != null && ask === base) {
      if (offered != null) {
        ask = offered * 1.07;
        reasons.push("Propozycja jest już w górze widełek / rynku – kontroferta ok. 5–10% wyżej to typowy, bezpieczny margines.");
      } else if (range?.max != null) {
        reasons.push("Celuj w górną granicę widełek – firma ją przewidziała w budżecie.");
      }
    }
    if (band && base != null && ask >= band.p75) reasons.push(`Kwota jest w górnej ćwiartce rynku (≥ ${fmtK(band.p75)}) – uzasadnij ją konkretnymi osiągnięciami.`);

    const ref = base;
    const position =
      band && ref != null ? (ref < band.p25 ? "below_p25" : ref < band.median ? "p25_median" : ref <= band.p75 ? "median_p75" : "above_p75") : undefined;
    out.push({ contract, offered, range, band, position, ask: up500(ask), reasons });
  }
  return out;
}
