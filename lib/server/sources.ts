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
  companyLogoThumbUrl?: string;
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
    logo: o.companyLogoThumbUrl || undefined,
    location: o.city,
    workMode: (o.workplaceType as WorkMode) === "remote" ? "remote" : workModeFrom(o.workplaceType),
    seniority: o.experienceLevel === "c_level" ? "lead" : seniorityFrom(o.experienceLevel),
    salaries,
    skills: (o.requiredSkills ?? []).map((s) => s.name),
    niceSkills: (o.niceToHaveSkills ?? []).map((s) => s.name),
    // publishedAt moves forward whenever the offer is refreshed; the list is sorted by it.
    publishedAt: o.publishedAt ?? o.lastPublishedAt,
    firstPublishedAt: [o.publishedAt, o.lastPublishedAt].filter(Boolean).sort()[0],
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
  logo?: { jobs_listing?: string; original?: string };
  tiles?: { values?: { value: string; type: string }[] };
}

const NFJ_CONTRACT: Record<string, Contract> = { b2b: "b2b", permanent: "uop", zlecenie: "uz" };

const nfjLogo = (logo: NfjPosting["logo"]) => {
  const path = logo?.jobs_listing || logo?.original;
  return path ? `https://static.nofluffjobs.com/${path}` : undefined;
};

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
    logo: nfjLogo(p.logo),
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
    firstPublishedAt: p.posted ? new Date(p.posted).toISOString() : undefined,
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
      const logo = card.match(/data-delayed-url="(https:\/\/media\.licdn\.com[^"]*company-logo[^"]*)"/)?.[1];
      const salary = salaryText ? parseSalaryText(salaryText) : undefined;
      return {
        title,
        company,
        url: `https://www.linkedin.com/jobs/view/${id}`,
        externalId: id,
        source: "linkedin",
        logo: logo ? decodeEntities(logo) : undefined,
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
    return linkedInDescription(await fetchText(linkedInPostingUrl(job.externalId ?? "")));
  },
};

const linkedInPostingUrl = (id: string) => `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${enc(id)}`;

function linkedInDescription(html: string): string {
  const body = html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  const criteria = [...html.matchAll(/description__job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>[\s\S]*?description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/g)]
    .map((m) => `${htmlToText(m[1])}: ${htmlToText(m[2])}`)
    .join("\n");
  return [htmlToText(body), criteria].filter(Boolean).join("\n\n");
}

/** One offer from LinkedIn's public job page (the guest view, no login). */
export function parseLinkedInPosting(html: string, id: string): JobInput | undefined {
  const title = attr(html, /top-card-layout__title[^>]*>([\s\S]*?)<\/h[12]>/);
  const company = attr(html, /topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/);
  if (!title || !company) return undefined;
  const location = attr(html, /class="topcard__flavor topcard__flavor--bullet"[^>]*>([\s\S]*?)<\/span>/);
  const salaryText = attr(html, /compensation__salary[^>]*>([\s\S]*?)<\/div>/);
  const salary = salaryText ? parseSalaryText(salaryText) : undefined;
  const description = linkedInDescription(html);
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
    description: description || undefined,
  };
}

// ───────────────────────────── a link the user pasted ─────────────────────────────

/** LinkedIn job id from its job links (jobs/view, comm/jobs/view, a search with currentJobId). */
export function linkedInJobId(url: string): string | undefined {
  if (!/linkedin\.com/i.test(url)) return undefined;
  return (
    url.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/)?.[1] ??
    url.match(/[?&](?:currentJobId|jobId)=(\d{6,})/)?.[1] ??
    url.match(/jobPosting[:/](\d{6,})/)?.[1]
  );
}

/** Portals that refuse automated requests: their offers come from the user (screenshot, pasted text), never fetched. */
export const BLOCKED_HOSTS = /(^|\.)(pracuj\.pl|theprotocol\.it)$/i;

const HOST_SOURCE: [RegExp, SourceId][] = [
  [/(^|\.)justjoin\.it$/i, "justjoin"],
  [/(^|\.)nofluffjobs\.com$/i, "nofluff"],
  [/(^|\.)bulldogjob\.pl$/i, "bulldogjob"],
  [/(^|\.)remotive\.com$/i, "remotive"],
  [/(^|\.)himalayas\.app$/i, "himalayas"],
];

interface LdPlace {
  address?: { addressLocality?: string } | string;
}
export interface LdPosting {
  "@type"?: string | string[];
  title?: string;
  description?: string;
  datePosted?: string;
  validThrough?: string;
  jobLocationType?: string;
  hiringOrganization?: { name?: string } | string;
  jobLocation?: LdPlace | LdPlace[];
  baseSalary?: { currency?: string; value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string } };
}

/** The schema.org JobPosting a job page embeds (most portals and career sites do). */
export function ldPosting(html: string): LdPosting | undefined {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      const list: LdPosting[] = Array.isArray(data) ? data : data["@graph"] ?? [data];
      const posting = list.find((d) => [d?.["@type"]].flat().includes("JobPosting"));
      if (posting) return posting;
    } catch {
      /* not JSON */
    }
  }
  return undefined;
}

const LD_PERIOD: Record<string, string> = { HOUR: "/h", DAY: "/dzień", MONTH: "/mies.", YEAR: "/rok" };
const isoDate = (s: string | undefined) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : undefined);

/** An offer from a job page's JobPosting data. */
export function offerFromLd(p: LdPosting, url: string, source: SourceId): JobInput | undefined {
  const org = typeof p.hiringOrganization === "string" ? p.hiringOrganization : p.hiringOrganization?.name;
  const title = p.title ? decodeEntities(p.title).trim() : undefined;
  if (!title || !org) return undefined;
  const places = [p.jobLocation ?? []].flat().map((l) => (typeof l.address === "string" ? l.address : l.address?.addressLocality));
  const location = [...new Set(places.filter((x): x is string => !!x))].join(", ") || undefined;
  const v = p.baseSalary?.value;
  const lo = v?.minValue ?? v?.value;
  const hi = v?.maxValue ?? lo;
  const unit = LD_PERIOD[(v?.unitText ?? "MONTH").toUpperCase()] ?? "";
  const salary = lo != null && p.baseSalary?.currency ? parseSalaryText(`${lo}–${hi} ${p.baseSalary.currency} ${unit}`) : undefined;
  return {
    title,
    company: decodeEntities(org).trim(),
    url,
    source,
    location,
    workMode: p.jobLocationType === "TELECOMMUTE" ? "remote" : workModeFrom(`${title} ${location ?? ""}`),
    seniority: seniorityFrom(title),
    salaries: salary ? [salary] : [],
    skills: [],
    description: p.description ? htmlToText(decodeEntities(p.description)) : undefined,
    publishedAt: isoDate(p.datePosted),
    expiresAt: isoDate(p.validThrough),
  };
}

export type LinkResult = { ok: true; job: JobInput } | { ok: false; url: string; reason: string };

/**
 * One offer from a link the user pasted: LinkedIn's public job page (one request, the same one the board makes for
 * the description), or the JobPosting data of any other job page. Portals that block automated requests
 * (Pracuj.pl, theprotocol.it) are never fetched – the user sends a screenshot instead.
 */
export async function offerFromLink(raw: string): Promise<LinkResult> {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, url: raw, reason: "to nie jest poprawny link" };
  }
  const fail = (reason: string): LinkResult => ({ ok: false, url: raw, reason });
  try {
    const liId = linkedInJobId(u.href);
    if (liId) {
      const job = parseLinkedInPosting(await fetchText(linkedInPostingUrl(liId)), liId);
      return job ? { ok: true, job } : fail("LinkedIn nie pokazuje tej oferty bez logowania (wygasła?) – wyślij zrzut ekranu");
    }
    if (/(^|\.)linkedin\.com$/i.test(u.hostname)) return fail("w linku nie ma numeru oferty (otwórz ofertę i skopiuj jej link)");
    if (BLOCKED_HOSTS.test(u.hostname)) return fail("ten portal blokuje automatyczne pobieranie – wyślij zrzut ekranu oferty");
    u.hash = "";
    const source = HOST_SOURCE.find(([re]) => re.test(u.hostname))?.[1] ?? "other";
    const posting = ldPosting(await fetchText(u.href));
    const job = posting && offerFromLd(posting, u.href, source);
    return job ? { ok: true, job } : fail("strona nie podaje danych oferty – wyślij zrzut ekranu");
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

// ───────────────────────────── any page ─────────────────────────────

/** Description from a job page: the schema.org JobPosting most portals embed, else the page text. */
export async function pageDescription(url: string): Promise<string> {
  const html = await fetchText(url);
  const posting = ldPosting(html);
  if (posting?.description) return htmlToText(String(posting.description));
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  return htmlToText(main).slice(0, 20_000);
}

// ───────────────────────────── Bulldogjob ─────────────────────────────

interface BulldogJob {
  id: string;
  position: string;
  company?: { name?: string; logo?: { url?: string } };
  city?: string;
  remote?: boolean;
  experienceLevel?: string;
  technologyTags?: string[];
  showSalary?: boolean;
  denominatedSalaryLong?: { money?: string | null; currency?: string | null };
  contractB2b?: boolean | null;
  contractEmployment?: boolean | null;
}

export function mapBulldog(j: BulldogJob): JobInput {
  const contract: Contract | undefined = j.contractB2b && !j.contractEmployment ? "b2b" : j.contractEmployment && !j.contractB2b ? "uop" : undefined;
  const money = j.showSalary !== false ? j.denominatedSalaryLong?.money : undefined;
  const salary = money ? parseSalaryText(`${money} ${j.denominatedSalaryLong?.currency ?? "PLN"}`, contract) : undefined;
  if (salary && contract === "uop") salary.gross ??= true;
  return {
    title: j.position,
    company: j.company?.name ?? "",
    url: `https://bulldogjob.pl/companies/jobs/${j.id}`,
    externalId: j.id,
    source: "bulldogjob",
    logo: j.company?.logo?.url,
    location: j.city,
    workMode: j.remote ? "remote" : undefined,
    seniority: j.experienceLevel === "medium" ? "mid" : seniorityFrom(j.experienceLevel),
    salaries: salary ? [salary] : [],
    skills: j.technologyTags ?? [],
  };
}

/** Bulldogjob lists by technology (its free-text search is not in the page data): "kotlin backend" → "Kotlin". */
const bulldogSkill = (keyword: string) => {
  const w = keyword.trim().split(/\s+/)[0] ?? "";
  return w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1);
};

const bulldogjob: Source = {
  id: "bulldogjob",
  async search(keyword) {
    // No publication dates in the list: every offer comes back, the merge skips the ones already on the board.
    const html = await fetchText(`https://bulldogjob.pl/companies/jobs/s/skills,${enc(bulldogSkill(keyword))}`);
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) throw new Error("Bulldogjob: zmienił się format strony");
    const jobs = (JSON.parse(m[1]) as { props: { pageProps: { jobs?: BulldogJob[] } } }).props.pageProps.jobs ?? [];
    return jobs.filter((j) => !j.experienceLevel || j.experienceLevel !== "intern").map(mapBulldog);
  },
  details: (job) => pageDescription(job.url),
};

// ───────────────────────────── remote boards from abroad (opt-in) ─────────────────────────────

/** Remote offers open to someone in Poland: worldwide, Europe / EU / EMEA / CET, or Poland itself. */
export function openToPoland(restrictions: string[] | string | undefined): boolean {
  const list = (Array.isArray(restrictions) ? restrictions : (restrictions ?? "").split(/[,;/]/)).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  return list.some((r) => /worldwide|anywhere|europe|\beu\b|emea|cet|poland|polska/.test(r));
}

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  company_logo?: string;
  tags?: string[];
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

export function mapRemotive(j: RemotiveJob): JobInput {
  const salary = j.salary ? parseSalaryText(j.salary) : undefined;
  return {
    title: j.title,
    company: j.company_name,
    url: j.url,
    externalId: String(j.id),
    source: "remotive",
    logo: j.company_logo,
    location: j.candidate_required_location || "Zdalnie",
    workMode: "remote",
    seniority: seniorityFrom(j.title),
    salaries: salary && salary.currency !== "PLN" ? [salary] : [],
    skills: j.tags ?? [],
    description: j.description ? htmlToText(j.description).slice(0, 20_000) : undefined,
    publishedAt: j.publication_date ? `${j.publication_date.replace(/Z?$/, "Z")}` : undefined,
  };
}

const remotive: Source = {
  id: "remotive",
  async search(keyword, { since }) {
    // Remotive asks for at most a few requests a day and a link back to the offer (the card links to it).
    const res = await fetchJson<{ jobs: RemotiveJob[] }>(`https://remotive.com/api/remote-jobs?category=software-dev&search=${enc(keyword)}&limit=100`);
    // Its search is loose ("kotlin" also finds service-desk jobs): keep offers that actually mention the phrase.
    const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);
    const mentions = (j: RemotiveJob) => {
      const text = `${j.title} ${(j.tags ?? []).join(" ")} ${j.description ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    };
    return res.jobs
      .filter((j) => openToPoland(j.candidate_required_location) && mentions(j))
      .map(mapRemotive)
      .filter((j) => newerThan(j.publishedAt, since));
  },
  details: async (job) => pageDescription(job.url),
};

interface HimalayasJob {
  title: string;
  companyName: string;
  companyLogo?: string;
  guid: string;
  applicationLink?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string;
  currency?: string;
  seniority?: string[];
  locationRestrictions?: string[];
  categories?: string[];
  description?: string;
  pubDate?: number;
  expiryDate?: number;
}

const HIMALAYAS_PERIOD: Record<string, Period> = { hourly: "hour", daily: "day", monthly: "month", annual: "year", yearly: "year" };

export function mapHimalayas(j: HimalayasJob): JobInput {
  const period = HIMALAYAS_PERIOD[(j.salaryPeriod ?? "annual").toLowerCase()] ?? "year";
  return {
    title: j.title,
    company: j.companyName,
    url: j.guid,
    externalId: j.guid,
    source: "himalayas",
    logo: j.companyLogo,
    location: j.locationRestrictions?.length ? j.locationRestrictions.join(", ") : "Zdalnie (cały świat)",
    workMode: "remote",
    seniority: seniorityFrom(j.seniority?.join(" ") ?? j.title),
    salaries: j.minSalary || j.maxSalary ? [{ min: j.minSalary ?? undefined, max: j.maxSalary ?? undefined, currency: j.currency ?? "USD", period, contract: "b2b" }] : [],
    skills: [],
    description: j.description ? htmlToText(j.description).slice(0, 20_000) : undefined,
    publishedAt: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : undefined,
    expiresAt: j.expiryDate ? new Date(j.expiryDate * 1000).toISOString() : undefined,
  };
}

const himalayas: Source = {
  id: "himalayas",
  async search(keyword, { since }) {
    const out: JobInput[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await fetchJson<{ jobs: HimalayasJob[] }>(`https://himalayas.app/jobs/api/search?q=${enc(keyword)}&page=${page}`);
      const fresh = res.jobs.filter((j) => openToPoland(j.locationRestrictions)).map(mapHimalayas).filter((j) => newerThan(j.publishedAt, since));
      out.push(...fresh);
      if (res.jobs.length < 20) break;
      await pause(500);
    }
    return out;
  },
  details: async (job) => pageDescription(job.url),
};

/**
 * Portals the scanner searches itself. Pracuj.pl and theprotocol.it block automated requests, so their
 * offers come in through Claude (add_jobs): from e-mail alerts, or from screenshots and links the user sends.
 */
export const SOURCE_IMPL: Partial<Record<SourceId, Source>> = { justjoin, nofluff, bulldogjob, linkedin, remotive, himalayas };

/**
 * Where to look for an offer known only from a screenshot (no link visible): the portal's search for its title and
 * company, or a web search. The card links there until a real link is added.
 */
export function searchLink(title: string, company: string, source: SourceId): string {
  const q = enc(`${title} ${company}`);
  return source === "linkedin"
    ? `https://www.linkedin.com/jobs/search/?keywords=${q}&location=Poland`
    : `https://www.google.com/search?q=${q}`;
}

export const isSearchLink = (url: string) => /linkedin\.com\/jobs\/search\/|google\.com\/search\?/i.test(url);

export async function jobDescription(job: Pick<Job, "url" | "externalId" | "source">): Promise<string> {
  if (isSearchLink(job.url)) throw new Error("oferta dodana ze zrzutu, bez linku – wyślij zrzut lub tekst jej treści");
  if (BLOCKED_HOSTS.test(new URL(job.url).hostname)) throw new Error("portal blokuje automatyczne pobieranie – wyślij zrzut lub tekst treści");
  const impl = SOURCE_IMPL[job.source];
  const text = impl && job.externalId ? await impl.details(job) : await pageDescription(job.url);
  return text.slice(0, 20_000);
}
