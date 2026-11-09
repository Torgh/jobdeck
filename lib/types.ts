/** Shared data model of JobDeck: used by the board, the API routes, the scanner and the MCP server. */

export const SOURCES = ["linkedin", "justjoin", "nofluff", "pracuj", "protocol", "other"] as const;
export type SourceId = (typeof SOURCES)[number];

export const SOURCE_LABEL: Record<SourceId, string> = {
  linkedin: "LinkedIn",
  justjoin: "Just Join IT",
  nofluff: "No Fluff Jobs",
  pracuj: "Pracuj.pl",
  protocol: "theprotocol.it",
  other: "Inne",
};

/**
 * Sources the scanner searches by itself. LinkedIn's public search is opt-in (it throttles quickly);
 * LinkedIn and Pracuj.pl offers mainly arrive from their e-mail alerts, which Claude reads via Gmail.
 */
export const SCANNABLE: SourceId[] = ["justjoin", "nofluff", "linkedin"];

export const STATUSES = ["new", "interesting", "applying", "applied", "interview", "offer", "closed"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  new: "Nowe",
  interesting: "Ciekawe",
  applying: "Aplikuję",
  applied: "Wysłane",
  interview: "Rozmowy",
  offer: "Oferta",
  closed: "Zamknięte",
};

export const CLOSED_REASONS = ["not_for_me", "rejected", "expired", "withdrew", "accepted"] as const;
export type ClosedReason = (typeof CLOSED_REASONS)[number];
export const CLOSED_LABEL: Record<ClosedReason, string> = {
  not_for_me: "Nie dla mnie",
  rejected: "Odrzucili",
  expired: "Wygasła",
  withdrew: "Wycofałem się",
  accepted: "Przyjęta 🎉",
};

export type WorkMode = "remote" | "hybrid" | "office";
export const WORK_MODE_LABEL: Record<WorkMode, string> = { remote: "Zdalnie", hybrid: "Hybrydowo", office: "Stacjonarnie" };

export type Seniority = "intern" | "junior" | "mid" | "senior" | "lead";
export const SENIORITIES: Seniority[] = ["intern", "junior", "mid", "senior", "lead"];
export const SENIORITY_LABEL: Record<Seniority, string> = {
  intern: "Staż",
  junior: "Junior",
  mid: "Mid",
  senior: "Senior",
  lead: "Lead / Expert",
};

export type Contract = "b2b" | "uop" | "uz" | "other";
export const CONTRACT_LABEL: Record<Contract, string> = { b2b: "B2B", uop: "UoP", uz: "UZ", other: "inna" };

export type Period = "hour" | "day" | "month" | "year";

export interface Salary {
  min?: number;
  max?: number;
  currency: string;
  period: Period;
  contract?: Contract;
  /** true = brutto, false = netto (B2B is netto + VAT). */
  gross?: boolean;
  /** min/max per month in PLN, filled in on import (hourly × 168, NBP rates). */
  monthlyPln?: { min?: number; max?: number };
}

export type Verdict = "strong" | "good" | "partial" | "weak";
export const VERDICT_LABEL: Record<Verdict, string> = {
  strong: "Świetne dopasowanie",
  good: "Dobre dopasowanie",
  partial: "Częściowe",
  weak: "Słabe",
};

/** Claude's assessment of how well the user's CV fits the offer. */
export interface Fit {
  score: number;
  verdict: Verdict;
  summary: string;
  strengths: string[];
  gaps: string[];
  ratedAt: string;
  /** Hash of the CV the rating was made against: a new CV marks old ratings as outdated. */
  cvHash?: string;
}

export interface JobLink {
  source: SourceId;
  url: string;
}

export interface Job {
  id: string;
  /** Normalised company + title, used to merge the same offer found on several portals. */
  key: string;
  title: string;
  company: string;
  url: string;
  source: SourceId;
  /** Every portal the offer was found on (the first one is `source`). */
  links: JobLink[];
  /** Portal's own id, used to fetch the full description. */
  externalId?: string;
  location?: string;
  workMode?: WorkMode;
  seniority?: Seniority;
  salaries: Salary[];
  skills: string[];
  niceSkills?: string[];
  /** Short teaser from the listing. */
  summary?: string;
  /** Full description, fetched when the offer is opened or rated. */
  description?: string;
  descriptionFetchedAt?: string;
  publishedAt?: string;
  expiresAt?: string;
  foundAt: string;
  updatedAt: string;
  status: Status;
  statusChangedAt: string;
  closedReason?: ClosedReason;
  fit?: Fit;
  /** Share (0–100) of the offer's listed skills that appear in the CV / profile skills: a quick pre-filter. */
  stackMatch?: number;
  starred?: boolean;
  notes?: string;
  appliedAt?: string;
  /** Next thing to do (follow-up, interview) and its date. */
  nextStep?: { date?: string; text: string };
}

export interface CvInfo {
  fileName: string;
  uploadedAt: string;
  hash: string;
  text: string;
}

export interface Profile {
  /** Search phrases sent to the portals ("java", "kotlin backend"). */
  keywords: string[];
  /** Cities; remote offers are always kept. Empty = whole Poland. */
  locations: string[];
  workModes: WorkMode[];
  seniority: Seniority[];
  contracts: Contract[];
  /** Expected minimum per month in PLN (B2B netto or UoP brutto). Offers clearly below are skipped. */
  minMonthlyPln?: number;
  /** Words in a title that make an offer irrelevant ("php", "sap"). */
  excludeKeywords: string[];
  excludeCompanies: string[];
  /** Portals the scanner searches (only SCANNABLE ones matter; linkedin = the opt-in public search). */
  sources: Record<SourceId, boolean>;
  /** Skills the user has (extracted from the CV by Claude, editable). */
  skills: string[];
  /** Free text: what the user is looking for, deal-breakers, the domain they want. */
  about?: string;
  cv?: CvInfo;
  updatedAt?: string;
}

export interface ScanSourceResult {
  source: SourceId;
  found: number;
  added: number;
  error?: string;
}

export interface ScanRecord {
  at: string;
  since: string;
  results: ScanSourceResult[];
  added: number;
}

export interface Db {
  version: number;
  jobs: Record<string, Job>;
  scans: ScanRecord[];
}

export const DEFAULT_PROFILE: Profile = {
  keywords: [],
  locations: [],
  workModes: ["remote", "hybrid"],
  seniority: ["mid", "senior"],
  contracts: ["b2b", "uop"],
  excludeKeywords: [],
  excludeCompanies: [],
  sources: { linkedin: false, justjoin: true, nofluff: true, pracuj: true, protocol: true, other: true },
  skills: [],
};

/** What a source returns for one offer, before it becomes a Job. */
export interface JobInput {
  title: string;
  company: string;
  url: string;
  source: SourceId;
  externalId?: string;
  location?: string;
  workMode?: WorkMode;
  seniority?: Seniority;
  salaries?: Salary[];
  skills?: string[];
  niceSkills?: string[];
  summary?: string;
  description?: string;
  publishedAt?: string;
  expiresAt?: string;
}
