import { filterReason, jobKey, stackMatch } from "../jobs";
import { FALLBACK_RATES, normalizeSalary } from "../salary";
import { SCANNABLE, type Db, type Job, type JobInput, type Profile, type ScanRecord, type ScanSourceResult, type SourceId } from "../types";
import { fetchJson } from "./http";
import { isSearchLink, SOURCE_IMPL } from "./sources";
import { newId, readDb, readProfile, updateDb } from "./store";

let ratesCache: { day: string; rates: Record<string, number> } | undefined;

/** Average NBP rates (table A), cached for the day; the fallbacks if NBP is unreachable. */
export async function plnRates(): Promise<Record<string, number>> {
  const day = new Date().toISOString().slice(0, 10);
  if (ratesCache?.day === day) return ratesCache.rates;
  try {
    const [table] = await fetchJson<{ rates: { code: string; mid: number }[] }[]>(
      "https://api.nbp.pl/api/exchangerates/tables/A/?format=json",
    );
    const rates: Record<string, number> = { PLN: 1 };
    for (const r of table.rates) rates[r.code] = r.mid;
    ratesCache = { day, rates };
    return rates;
  } catch {
    return FALLBACK_RATES;
  }
}

function earliest(...dates: (string | undefined)[]): string | undefined {
  return dates.filter((d): d is string => !!d && !Number.isNaN(Date.parse(d))).sort()[0];
}

export interface IngestResult {
  added: Job[];
  merged: number;
  skipped: { title: string; company: string; reason: string }[];
}

/**
 * Puts offers on the board: new ones go to "Nowe", ones already there (from another portal or an
 * earlier scan) only gain the extra link and any data they were missing.
 */
export function ingest(db: Db, inputs: JobInput[], profile: Profile, rates: Record<string, number>, opts: { force?: boolean; keywords?: string[] } = {}): IngestResult {
  const now = new Date().toISOString();
  const byKey = new Map(Object.values(db.jobs).map((j) => [j.key, j]));
  const byUrl = new Map(Object.values(db.jobs).flatMap((j) => j.links.map((l) => [l.url, j] as const)));
  const res: IngestResult = { added: [], merged: 0, skipped: [] };

  for (const input of inputs) {
    if (!input.title || !input.company || !input.url) continue;
    const key = jobKey(input.title, input.company);
    const existing = byUrl.get(input.url) ?? byKey.get(key);
    const salaries = (input.salaries ?? []).map((s) => normalizeSalary(s, rates));
    if (existing) {
      // A card added from a screenshot links to a search until the real offer link arrives.
      if (isSearchLink(existing.url) && !isSearchLink(input.url)) {
        existing.links = existing.links.filter((l) => l.url !== existing.url);
        existing.url = input.url;
        existing.source = input.source;
        existing.externalId ??= input.externalId;
      }
      if (!existing.links.some((l) => l.url === input.url || l.source === input.source)) existing.links.push({ source: input.source, url: input.url });
      if (!existing.description && input.description) {
        existing.description = input.description;
        existing.descriptionFetchedAt = now;
      }
      if (!existing.salaries.length && salaries.length) existing.salaries = salaries;
      if (!existing.skills.length && input.skills?.length) {
        existing.skills = input.skills;
        existing.stackMatch = stackMatch(existing.skills, profile);
      }
      existing.logo ??= input.logo;
      existing.location ??= input.location;
      existing.workMode ??= input.workMode;
      existing.seniority ??= input.seniority;
      existing.summary ??= input.summary;
      if (input.publishedAt && (!existing.publishedAt || input.publishedAt > existing.publishedAt)) {
        // Re-published (bumped) more than a day after the date we knew: count it.
        if (existing.publishedAt && Date.parse(input.publishedAt) - Date.parse(existing.publishedAt) > 86_400_000) {
          existing.refreshCount = (existing.refreshCount ?? 0) + 1;
        }
        existing.publishedAt = input.publishedAt;
      }
      const first = earliest(existing.firstPublishedAt, input.firstPublishedAt, input.publishedAt);
      if (first) existing.firstPublishedAt = first;
      existing.updatedAt = now;
      res.merged++;
      continue;
    }
    const reason = opts.force ? undefined : filterReason({ ...input, salaries }, profile, { keywords: opts.keywords });
    if (reason) {
      res.skipped.push({ title: input.title, company: input.company, reason });
      continue;
    }
    const skills = [...new Set(input.skills ?? [])];
    const job: Job = {
      id: newId(),
      key,
      title: input.title,
      company: input.company,
      url: input.url,
      source: input.source,
      links: [{ source: input.source, url: input.url }],
      externalId: input.externalId,
      logo: input.logo,
      location: input.location,
      workMode: input.workMode,
      seniority: input.seniority,
      salaries,
      skills,
      niceSkills: input.niceSkills,
      summary: input.summary,
      description: input.description,
      descriptionFetchedAt: input.description ? now : undefined,
      publishedAt: input.publishedAt,
      firstPublishedAt: earliest(input.firstPublishedAt, input.publishedAt),
      expiresAt: input.expiresAt,
      abroad: input.abroad || undefined,
      foundAt: now,
      updatedAt: now,
      status: "new",
      statusChangedAt: now,
      stackMatch: stackMatch(skills, profile),
    };
    db.jobs[job.id] = job;
    byKey.set(key, job);
    byUrl.set(input.url, job);
    res.added.push(job);
  }
  return res;
}

export interface ScanOptions {
  sources?: SourceId[];
  keywords?: string[];
  /** Look back this many days instead of "since the last scan". */
  days?: number;
}

export interface ScanResult extends ScanRecord {
  newJobs: Job[];
  skipped: number;
}

/** Searches every enabled portal for every keyword, then adds what is new since the last scan. */
export async function scan(opts: ScanOptions = {}): Promise<ScanResult> {
  const profile = readProfile();
  const keywords = opts.keywords?.length ? opts.keywords : profile.keywords;
  if (!keywords.length) throw new Error("Brak fraz do wyszukania: dodaj je w Ustawieniach (np. „java”, „kotlin”).");
  const last = readDb().scans.at(-1);
  // A day of overlap with the last scan: portals publish with a delay and re-dated offers are merged anyway.
  const since = opts.days
    ? new Date(Date.now() - opts.days * 86_400_000)
    : last
      ? new Date(Date.parse(last.at) - 86_400_000)
      : new Date(Date.now() - 14 * 86_400_000);
  const sources = (opts.sources ?? SCANNABLE).filter((s) => profile.sources[s] && SOURCE_IMPL[s]);
  const rates = await plnRates();

  const perSource = await Promise.all(
    sources.map(async (id) => {
      const found: JobInput[] = [];
      const errors: string[] = [];
      for (const kw of keywords) {
        try {
          found.push(...(await SOURCE_IMPL[id]!.search(kw, { since, profile })));
        } catch (e) {
          errors.push(`${kw}: ${(e as Error).message}`);
          if (/HTTP 429/.test((e as Error).message)) break;
        }
      }
      return { id, found, error: errors.join("; ") || undefined };
    }),
  );

  return updateDb((db) => {
    const results: ScanSourceResult[] = [];
    const newJobs: Job[] = [];
    let skipped = 0;
    for (const s of perSource) {
      const r = ingest(db, s.found, profile, rates, { keywords });
      newJobs.push(...r.added);
      skipped += r.skipped.length;
      results.push({ source: s.id, found: s.found.length, added: r.added.length, error: s.error });
    }
    const record: ScanRecord = { at: new Date().toISOString(), since: since.toISOString(), results, added: newJobs.length };
    db.scans = [...db.scans, record].slice(-50);
    return { ...record, newJobs, skipped };
  });
}

export async function addJobs(inputs: JobInput[], opts: { force?: boolean } = {}): Promise<IngestResult> {
  const profile = readProfile();
  const rates = await plnRates();
  return updateDb((db) => ingest(db, inputs, profile, rates, opts));
}
