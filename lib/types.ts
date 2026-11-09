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

/** Something that happened with an application: a status change, an e-mail from the company, a note. */
export const EVENT_KINDS = ["status", "sent", "reply", "interview_invite", "task", "rejection", "offer", "note"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_LABEL: Record<EventKind, string> = {
  status: "Zmiana etapu",
  sent: "Wysłano aplikację",
  reply: "Odpowiedź",
  interview_invite: "Zaproszenie na rozmowę",
  task: "Zadanie rekrutacyjne",
  rejection: "Odmowa",
  offer: "Oferta",
  note: "Notatka",
};
export const EVENT_ICON: Record<EventKind, string> = {
  status: "→",
  sent: "📤",
  reply: "✉️",
  interview_invite: "📅",
  task: "🧩",
  rejection: "✗",
  offer: "🎉",
  note: "📝",
};

export interface JobEvent {
  at: string;
  kind: EventKind;
  text: string;
  /** Who recorded it: the board, or Claude (from Gmail). */
  by?: "app" | "claude";
  /** For e-mails: sender and subject, so the user can find the message. */
  from?: string;
  subject?: string;
}

/** A document Claude tailored for this offer, as Markdown. */
export interface AppDoc {
  markdown: string;
  updatedAt: string;
  language?: "pl" | "en";
}

export const DOC_KINDS = ["cv", "letter"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const DOC_LABEL: Record<DocKind, string> = { cv: "CV", letter: "List motywacyjny" };

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
  /** Company logo URL from the portal. */
  logo?: string;
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
  /** The application's history, oldest first. */
  events?: JobEvent[];
  /** CV and cover letter tailored for this offer. */
  documents?: Partial<Record<DocKind, AppDoc>>;
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
  /** Getting-started steps the user ticks off themselves (the rest are detected). */
  onboarding?: { alerts?: boolean; gmail?: boolean; hidden?: boolean };
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

/** A rating of the employer on a review site (GoWork.pl, Glassdoor, Indeed…). */
export interface CompanyRating {
  site: string;
  score: number;
  /** Top of the scale, e.g. 5. */
  outOf: number;
  reviews?: number;
  url?: string;
}

/** What Claude found out about an employer: shown with every offer from that company. */
export interface CompanyInfo {
  name: string;
  summary: string;
  industry?: string;
  size?: string;
  website?: string;
  /** "produkt", "software house", "body leasing / outsourcing", "agencja rekrutacyjna"… */
  kind?: string;
  ratings: CompanyRating[];
  pros: string[];
  cons: string[];
  /** Things to check or ask about in the interview (layoffs, frequent re-posting, unclear client). */
  flags: string[];
  sources: { title: string; url: string }[];
  researchedAt: string;
}

export interface Db {
  version: number;
  jobs: Record<string, Job>;
  scans: ScanRecord[];
  /** By companyKey(). */
  companies?: Record<string, CompanyInfo>;
  /** Until when Claude has gone through the mailbox for replies from employers. */
  mailCheckedAt?: string;
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
  logo?: string;
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
