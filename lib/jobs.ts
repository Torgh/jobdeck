import { bestMonthly } from "./salary";
import type { Job, JobInput, Profile, Seniority, Status, WorkMode } from "./types";

/** Lowercase, no Polish diacritics, no punctuation. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}

const COMPANY_NOISE = /\b(sp z o o|sp zoo|spolka z ograniczona odpowiedzialnoscia|s a|sa|sp k|sp j|ltd|gmbh|inc|llc|poland|polska|group|sp)\b/g;
const TITLE_NOISE = /\b(m f d|f m x|m f x|k m|m k|f m|m f|remote|zdalnie|hybrid|hybrydowo|b2b|uop|100)\b/g;

export function companyKey(company: string): string {
  return fold(company).replace(COMPANY_NOISE, " ").replace(/\s+/g, " ").trim();
}

/** The same role at the same company is one card, whichever portal it came from. */
export function jobKey(title: string, company: string): string {
  const t = fold(title).replace(TITLE_NOISE, " ").replace(/\s+/g, " ").trim();
  return `${companyKey(company)}|${t}`;
}

export function seniorityFrom(text: string | undefined): Seniority | undefined {
  if (!text) return undefined;
  const t = fold(text);
  if (/\b(intern|stazysta|staz|praktykant|trainee)\b/.test(t)) return "intern";
  if (/\b(lead|principal|staff|architect|head|expert|ekspert|kierownik|manager|c level)\b/.test(t)) return "lead";
  if (/\b(senior|starszy|sr)\b/.test(t)) return "senior";
  if (/\b(junior|mlodszy|jr|entry)\b/.test(t)) return "junior";
  if (/\b(mid|regular|specjalista)\b/.test(t)) return "mid";
  return undefined;
}

export function workModeFrom(text: string | undefined): WorkMode | undefined {
  if (!text) return undefined;
  const t = fold(text);
  if (/zdaln|remote|home office/.test(t)) return "remote";
  if (/hybry|hybrid/.test(t)) return "hybrid";
  if (/stacjonar|office|on site|onsite|full office/.test(t)) return "office";
  return undefined;
}

/** Where the user's skills come from: the CV text and the profile's skill list. */
export type SkillSource = { skills: string[]; cv?: { text: string } };

/** Share of the offer's listed skills that the user has (CV text + profile skills). */
export function stackMatch(skills: string[], profile: SkillSource): number | undefined {
  if (!skills.length) return undefined;
  const hay = ` ${fold(`${profile.cv?.text ?? ""} ${profile.skills.join(" ")}`)} `;
  if (hay.trim().length === 0) return undefined;
  const hit = skills.filter((s) => {
    const f = fold(s);
    return f.length > 0 && hay.includes(` ${f} `);
  }).length;
  return Math.round((hit / skills.length) * 100);
}

export function matchedSkills(skills: string[], profile: SkillSource): Set<string> {
  const hay = ` ${fold(`${profile.cv?.text ?? ""} ${profile.skills.join(" ")}`)} `;
  return new Set(skills.filter((s) => fold(s) && hay.includes(` ${fold(s)} `)));
}

/** Why an offer should not even reach the board, or undefined to keep it. */
export function filterReason(input: JobInput, profile: Profile): string | undefined {
  const title = fold(input.title);
  for (const word of profile.excludeKeywords) {
    const w = fold(word);
    if (w && ` ${title} `.includes(` ${w} `)) return `wykluczone słowo „${word}”`;
  }
  const ck = companyKey(input.company);
  if (profile.excludeCompanies.some((c) => companyKey(c) === ck && ck)) return "wykluczona firma";
  const seniority = input.seniority ?? seniorityFrom(input.title);
  if (seniority && profile.seniority.length && !profile.seniority.includes(seniority)) return `poziom ${seniority}`;
  if (input.workMode && profile.workModes.length && !profile.workModes.includes(input.workMode)) {
    return `tryb ${input.workMode}`;
  }
  if (input.workMode !== "remote" && profile.locations.length && input.location) {
    const loc = fold(input.location);
    const anywhere = /cala polska|whole poland|poland$|polska$/.test(loc);
    if (!anywhere && !profile.locations.some((l) => loc.includes(fold(l)))) return `lokalizacja ${input.location}`;
  }
  if (profile.minMonthlyPln && input.salaries?.length) {
    const best = bestMonthly(input.salaries);
    const top = best?.max ?? best?.min;
    if (top && top < profile.minMonthlyPln * 0.9) return "widełki poniżej oczekiwań";
  }
  return undefined;
}

export function isStale(job: Job, days: number, now = Date.now()): boolean {
  return now - Date.parse(job.statusChangedAt) > days * 86_400_000;
}

export interface Todo {
  jobId: string;
  kind: "follow_up" | "next_step" | "expiring" | "outdated_fit";
  text: string;
  date?: string;
}

const ACTIVE: Status[] = ["interesting", "applying", "applied", "interview", "offer"];

/** The "Do ogarnięcia" list: follow-ups, due next steps, expiring offers the user cares about. */
export function todos(jobs: Job[], cvHash: string | undefined, now = Date.now()): Todo[] {
  const out: Todo[] = [];
  const today = new Date(now).toISOString().slice(0, 10);
  for (const j of jobs) {
    const who = `${j.title} @ ${j.company}`;
    if (j.nextStep?.date && j.nextStep.date <= today && ACTIVE.includes(j.status)) {
      out.push({ jobId: j.id, kind: "next_step", text: `${j.nextStep.text} – ${who}`, date: j.nextStep.date });
    }
    if (j.status === "applied" && !j.nextStep && isStale(j, 7, now)) {
      const days = Math.floor((now - Date.parse(j.statusChangedAt)) / 86_400_000);
      out.push({ jobId: j.id, kind: "follow_up", text: `Brak odpowiedzi od ${days} dni – przypomnij się: ${who}` });
    }
    if ((j.status === "interesting" || j.status === "applying") && j.expiresAt) {
      const left = (Date.parse(j.expiresAt) - now) / 86_400_000;
      if (left >= 0 && left <= 3) {
        out.push({ jobId: j.id, kind: "expiring", text: `Oferta wygasa za ${Math.ceil(left)} dni: ${who}`, date: j.expiresAt.slice(0, 10) });
      }
    }
    if (j.fit && cvHash && j.fit.cvHash && j.fit.cvHash !== cvHash && ACTIVE.includes(j.status)) {
      out.push({ jobId: j.id, kind: "outdated_fit", text: `Ocena sprzed zmiany CV: ${who}` });
    }
  }
  return out.sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9"));
}

/** Board order inside a column: Claude's score, then the stack match, then the newest. */
export function compareJobs(a: Job, b: Job): number {
  if (!!a.starred !== !!b.starred) return a.starred ? -1 : 1;
  const fa = a.fit?.score ?? -1;
  const fb = b.fit?.score ?? -1;
  if (fa !== fb) return fb - fa;
  const ma = a.stackMatch ?? -1;
  const mb = b.stackMatch ?? -1;
  if (ma !== mb) return mb - ma;
  return (b.publishedAt ?? b.foundAt).localeCompare(a.publishedAt ?? a.foundAt);
}
