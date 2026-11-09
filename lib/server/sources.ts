import { seniorityFrom, workModeFrom } from "../jobs";
import { parseSalaryText } from "../salary";
import type { Contract, Job, JobInput, Period, Profile, Salary, SourceId, WorkMode } from "../types";
import { decodeEntities, fetchJson, fetchText, htmlToText, pause } from "./http";

export interface SearchOptions {
  since: Date;
  profile: Profile;
}

export interface Source {
  id: SourceId;
  search(keyword: string, opts: SearchOptions): Promise<JobInput[]>;
  /** Full description of one offer as plain text. */
  details(job: Pick<Job, "url" | "externalId">): Promise<string>;
}

const newerThan = (iso: string | undefined, since: Date) => !iso || Date.parse(iso) >= since.getTime();
const enc = encodeURIComponent;

// ───────────────────────────── Just Join IT ─────────────────────────────

interface JjitOffer {
  slug: string;
  title: string;
  companyName: string;
  city?: string;
  workplaceType?: string;
  experienceLevel?: string;
  publishedAt?: string;
  lastPublishedAt?: string;
  expiredAt?: string;
  employmentTypes?: {
    /** Monthly equivalent. */
    from?: number | null;
    to?: number | null;
    /** The amount per `unit` (e.g. per hour) as the employer wrote it. */
    fromPerUnit?: number | null;
    toPerUnit?: number | null;
    currency: string;
    currencySource?: string;
    type: string;
    unit?: string;
    gross?: boolean;
  }[];
  requiredSkills?: { name: string }[];
  niceToHaveSkills?: { name: string }[] | null;
}

const JJIT_CONTRACT: Record<string, Contract> = { b2b: "b2b", permanent: "uop", mandate_contract: "uz" };
const JJIT_PERIOD: Record<string, Period> = { hour: "hour", day: "day", month: "month", year: "year" };

export function mapJustJoin(o: JjitOffer): JobInput {
  const salaries: Salary[] = (o.employmentTypes ?? [])
    .filter((e) => e.currencySource !== "conversion" && (e.from || e.to))
    .map((e) => {
      const perUnit = e.fromPerUnit != null || e.toPerUnit != null;
      return {
        min: (perUnit ? e.fromPerUnit : e.from) ?? undefined,
        max: (perUnit ? e.toPerUnit : e.to) ?? undefined,
        currency: e.currency,
        period: perUnit ? (JJIT_PERIOD[(e.unit ?? "month").toLowerCase()] ?? "month") : "month",
        contract: JJIT_CONTRACT[e.type] ?? "other",
        gross: e.gross,
      } satisfies Salary;
    });
  return {
    title: o.title,
    company: o.companyName,
    url: `https://justjoin.it/job-offer/${o.slug}`,
    externalId: o.slug,
    source: "justjoin",
    location: o.city,
    workMode: (o.workplaceType as WorkMode) === "remote" ? "remote" : workModeFrom(o.workplaceType),
    seniority: o.experienceLevel === "c_level" ? "lead" : seniorityFrom(o.experienceLevel),
    salaries,
    skills: (o.requiredSkills ?? []).map((s) => s.name),
    niceSkills: (o.niceToHaveSkills ?? []).map((s) => s.name),
    // publishedAt moves forward whenever the offer is refreshed; the list is sorted by it.
    publishedAt: o.publishedAt ?? o.lastPublishedAt,
    expiresAt: o.expiredAt,
  };
}

const justjoin: Source = {
  id: "justjoin",
  async search(keyword, { since }) {
    const out: JobInput[] = [];
    // The API pages by 10; stop at the first page older than the last scan.
    for (let from = 0; from < 200; from += 10) {
      const url = `https://justjoin.it/api/candidate-api/offers?keywords=${enc(keyword)}&perPage=10&from=${from}&sortBy=publishedAt&orderBy=descending`;
      const page = await fetchJson<{ data: JjitOffer[] }>(url);
      const fresh = page.data.filter((o) => newerThan(o.publishedAt ?? o.lastPublishedAt, since));
      out.push(...fresh.map(mapJustJoin));
      if (page.data.length < 10 || fresh.length < page.data.length) break;
      await pause(250);
    }
    return out;
  },
  async details(job) {
    const o = await fetchJson<{ body?: string }>(`https://justjoin.it/api/candidate-api/offers/${enc(job.externalId ?? "")}`);
    return htmlToText(o.body ?? "");
  },
};

// ───────────────────────────── No Fluff Jobs ─────────────────────────────

interface NfjPosting {
  id: string;
  url: string;
  name: string;
  title: string;
  posted: number;
  renewed?: number;
  seniority?: string[];
  fullyRemote?: boolean;
  location?: { places?: { city?: string }[]; fullyRemote?: boolean; type?: string };
  salary?: { from?: number; to?: number; type?: string; currency?: string; period?: string };
  tiles?: { values?: { value: string; type: string }[] };
}

const NFJ_CONTRACT: Record<string, Contract> = { b2b: "b2b", permanent: "uop", zlecenie: "uz" };

export function mapNoFluff(p: NfjPosting): JobInput {
  const remote = p.fullyRemote || p.location?.fullyRemote;
  const at = Math.max(p.posted ?? 0, p.renewed ?? 0);
  const s = p.salary;
  return {
    title: p.title,
    company: p.name,
    url: `https://nofluffjobs.com/pl/job/${p.url}`,
    externalId: p.url,
    source: "nofluff",
    location: p.location?.places?.find((pl) => pl.city && !/^remote$/i.test(pl.city))?.city,
    workMode: remote ? "remote" : workModeFrom(p.location?.type),
    seniority: seniorityFrom(p.seniority?.at(-1)),
    // The search asks for monthly PLN, so the amounts are already per month.
    salaries:
      s && (s.from || s.to)
        ? [{ min: s.from, max: s.to, currency: s.currency ?? "PLN", period: "month", contract: NFJ_CONTRACT[s.type ?? ""] ?? "other" }]
        : [],
    skills: (p.tiles?.values ?? []).filter((t) => t.type === "requirement").map((t) => t.value),
    publishedAt: at ? new Date(at).toISOString() : undefined,
  };
}

const nofluff: Source = {
  id: "nofluff",
  async search(keyword, { since }) {
    const res = await fetchJson<{ postings: NfjPosting[] }>(
      "https://nofluffjobs.com/api/search/posting?page=1&salaryCurrency=PLN&salaryPeriod=month&region=pl&language=pl-PL",
      {
        method: "POST",
        headers: { "Content-Type": "application/infiniteSearch+json" },
        body: JSON.stringify({ criteriaSearch: { keyword: [keyword] }, page: 1 }),
      },
    );
    return res.postings
      .filter((p) => Math.max(p.posted ?? 0, p.renewed ?? 0) >= since.getTime())
      .map(mapNoFluff);
  },
  async details(job) {
    const p = await fetchJson<{
      requirements?: { description?: string; musts?: { value: string }[]; nices?: { value: string }[] };
      details?: { description?: string };
      specs?: { dailyTasks?: string[] };
      company?: { name?: string };
    }>(`https://nofluffjobs.com/api/posting/${enc(job.externalId ?? "")}`);
    const parts = [
      p.requirements?.musts?.length ? `Wymagania: ${p.requirements.musts.map((m) => m.value).join(", ")}` : "",
      p.requirements?.nices?.length ? `Mile widziane: ${p.requirements.nices.map((m) => m.value).join(", ")}` : "",
      htmlToText(p.requirements?.description ?? ""),
      htmlToText(p.details?.description ?? ""),
      p.specs?.dailyTasks?.length ? `Zadania:\n• ${p.specs.dailyTasks.join("\n• ")}` : "",
    ];
    return parts.filter(Boolean).join("\n\n");
  },
};

// ───────────────────────────── LinkedIn (public guest search, no login) ─────────────────────────────

const LI_WORK_TYPE: Record<WorkMode, string> = { office: "1", remote: "2", hybrid: "3" };

const attr = (s: string, re: RegExp) => {
  const m = s.match(re);
  return m ? decodeEntities(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()) : undefined;
};

export function parseLinkedInCards(html: string): JobInput[] {
  return html
    .split(/<li>/)
    .slice(1)
    .map((card): JobInput | undefined => {
      const id = card.match(/urn:li:jobPosting:(\d+)/)?.[1];
      const title = attr(card, /base-search-card__title[^>]*>([\s\S]*?)<\/h3>/);
      const company = attr(card, /base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/);
      if (!id || !title || !company) return undefined;
      const location = attr(card, /job-search-card__location[^>]*>([\s\S]*?)<\/span>/);
      const salaryText = attr(card, /job-search-card__salary-info[^>]*>([\s\S]*?)<\/span>/);
      const date = card.match(/<time[^>]*datetime="([\d-]+)"/)?.[1];
      const salary = salaryText ? parseSalaryText(salaryText) : undefined;
      return {
        title,
        company,
        url: `https://www.linkedin.com/jobs/view/${id}`,
        externalId: id,
        source: "linkedin",
        location,
        workMode: workModeFrom(`${title} ${location ?? ""}`),
        seniority: seniorityFrom(title),
        salaries: salary ? [salary] : [],
        skills: [],
        publishedAt: date ? `${date}T00:00:00Z` : undefined,
      };
    })
    .filter((j): j is JobInput => !!j);
}

const linkedin: Source = {
  id: "linkedin",
  async search(keyword, { since, profile }) {
    const seconds = Math.max(86_400, Math.round((Date.now() - since.getTime()) / 1000));
    const wt = profile.workModes.map((m) => LI_WORK_TYPE[m]).join(",");
    const out: JobInput[] = [];
    // Opt-in and gentle: at most 4 pages of 10, with pauses; a refusal (HTTP 429) ends the search, no retries.
    for (let start = 0; start < 40; start += 10) {
      const url =
        `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${enc(keyword)}` +
        `&location=Poland&f_TPR=r${seconds}${wt ? `&f_WT=${enc(wt)}` : ""}&sortBy=DD&start=${start}`;
      const cards = parseLinkedInCards(await fetchText(url));
      out.push(...cards);
      if (cards.length < 10) break;
      await pause(2000);
    }
    return out;
  },
  async details(job) {
    const html = await fetchText(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${enc(job.externalId ?? "")}`);
    const body = html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const criteria = [...html.matchAll(/description__job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>[\s\S]*?description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/g)]
      .map((m) => `${htmlToText(m[1])}: ${htmlToText(m[2])}`)
      .join("\n");
    return [htmlToText(body), criteria].filter(Boolean).join("\n\n");
  },
};

// ───────────────────────────── any page ─────────────────────────────

/** Description from a job page: the schema.org JobPosting most portals embed, else the page text. */
export async function pageDescription(url: string): Promise<string> {
  const html = await fetchText(url);
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      const list = Array.isArray(data) ? data : data["@graph"] ?? [data];
      const posting = list.find((d: { "@type"?: string }) => d?.["@type"] === "JobPosting");
      if (posting?.description) return htmlToText(String(posting.description));
    } catch {
      /* not JSON */
    }
  }
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  return htmlToText(main).slice(0, 20_000);
}

/**
 * Portals the scanner searches itself. Pracuj.pl and theprotocol.it block automated requests, so their
 * offers come in through the e-mail alerts that Claude reads (add_jobs), like LinkedIn's.
 */
export const SOURCE_IMPL: Partial<Record<SourceId, Source>> = { justjoin, nofluff, linkedin };

export async function jobDescription(job: Pick<Job, "url" | "externalId" | "source">): Promise<string> {
  const impl = SOURCE_IMPL[job.source];
  const text = impl && job.externalId ? await impl.details(job) : await pageDescription(job.url);
  return text.slice(0, 20_000);
}
