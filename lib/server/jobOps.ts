import { companyKey } from "../jobs";
import {
  CLOSED_LABEL,
  STATUS_LABEL,
  type AppDoc,
  type ClosedReason,
  type CompanyInfo,
  type DocKind,
  type EventKind,
  type Fit,
  type Job,
  type JobEvent,
  type Status,
  type Verdict,
} from "../types";
import { jobDescription } from "./sources";
import { readDb, readProfile, updateDb } from "./store";

export class NotFound extends Error {}

export interface JobPatch {
  status?: Status;
  closedReason?: ClosedReason;
  notes?: string;
  starred?: boolean;
  nextStep?: { date?: string; text: string } | null;
  appliedAt?: string;
}

export function pushEvent(job: Job, event: JobEvent) {
  job.events = [...(job.events ?? []), event].sort((a, b) => a.at.localeCompare(b.at));
}

export function applyPatch(job: Job, patch: JobPatch, now = new Date().toISOString(), by: JobEvent["by"] = "app", recordStatus = true) {
  if (patch.status && patch.status !== job.status) {
    const from = job.status;
    job.status = patch.status;
    job.statusChangedAt = now;
    if (patch.status === "applied" && !job.appliedAt) job.appliedAt = now.slice(0, 10);
    if (patch.status !== "closed") delete job.closedReason;
    // Sorting out the inbox is not part of an application's story.
    if (recordStatus && !(from === "new" && (patch.status === "interesting" || patch.status === "closed"))) {
      const reason = patch.status === "closed" && patch.closedReason ? ` (${CLOSED_LABEL[patch.closedReason]})` : "";
      pushEvent(job, { at: now, kind: patch.status === "applied" ? "sent" : "status", text: `${STATUS_LABEL[from]} → ${STATUS_LABEL[patch.status]}${reason}`, by });
    }
  }
  if (patch.status === "closed" || job.status === "closed") {
    if (patch.closedReason) job.closedReason = patch.closedReason;
    else job.closedReason ??= "not_for_me";
  }
  if (patch.notes !== undefined) job.notes = patch.notes || undefined;
  if (patch.starred !== undefined) job.starred = patch.starred || undefined;
  if (patch.appliedAt !== undefined) job.appliedAt = patch.appliedAt || undefined;
  if (patch.nextStep !== undefined) {
    if (patch.nextStep && patch.nextStep.text.trim()) job.nextStep = { text: patch.nextStep.text.trim(), date: patch.nextStep.date || undefined };
    else delete job.nextStep;
  }
  job.updatedAt = now;
}

export function patchJobs(ids: string[], patch: JobPatch): Promise<Job[]> {
  return updateDb((db) => {
    return ids.map((id) => {
      const job = db.jobs[id];
      if (!job) throw new NotFound(`Nie ma oferty o id "${id}".`);
      applyPatch(job, patch);
      return job;
    });
  });
}

/** The job with its full description, fetched from the portal the first time. */
export async function jobWithDescription(id: string): Promise<Job> {
  const job = readDb().jobs[id];
  if (!job) throw new NotFound(`Nie ma oferty o id "${id}".`);
  if (job.description) return job;
  let description: string;
  try {
    description = await jobDescription(job);
  } catch (e) {
    return { ...job, description: `(Nie udało się pobrać opisu: ${(e as Error).message}. Otwórz ${job.url})` };
  }
  return updateDb((db) => {
    const j = db.jobs[id];
    if (!j) throw new NotFound(`Nie ma oferty o id "${id}".`);
    j.description = description;
    j.descriptionFetchedAt = new Date().toISOString();
    return j;
  });
}

export interface RatingInput {
  job_id: string;
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
}

export function verdictOf(score: number): Verdict {
  return score >= 80 ? "strong" : score >= 65 ? "good" : score >= 45 ? "partial" : "weak";
}

export function rateJobs(ratings: RatingInput[]): Promise<Job[]> {
  const cvHash = readProfile().cv?.hash;
  return updateDb((db) =>
    ratings.map((r) => {
      const job = db.jobs[r.job_id];
      if (!job) throw new NotFound(`Nie ma oferty o id "${r.job_id}".`);
      const score = Math.max(0, Math.min(100, Math.round(r.score)));
      const fit: Fit = {
        score,
        verdict: verdictOf(score),
        summary: r.summary.trim(),
        strengths: r.strengths.filter(Boolean),
        gaps: r.gaps.filter(Boolean),
        ratedAt: new Date().toISOString(),
        cvHash,
      };
      job.fit = fit;
      job.updatedAt = fit.ratedAt;
      return job;
    }),
  );
}

/** Stores what Claude found out about an employer; every offer from that company shows it. */
export function saveCompany(info: Omit<CompanyInfo, "researchedAt">): Promise<CompanyInfo> {
  const key = companyKey(info.name);
  if (!key) throw new Error("Podaj nazwę firmy.");
  return updateDb((db) => {
    const saved: CompanyInfo = { ...info, researchedAt: new Date().toISOString() };
    db.companies = { ...db.companies, [key]: saved };
    return saved;
  });
}

export interface EventInput {
  job_id: string;
  kind: Exclude<EventKind, "status">;
  /** When it happened (e-mail date), ISO. */
  at?: string;
  text: string;
  from?: string;
  subject?: string;
  /** Interview / task deadline (YYYY-MM-DD) for interview_invite and task. */
  date?: string;
}

/** What an event does to the card besides being recorded. */
function eventPatch(e: EventInput, job: Job): JobPatch {
  switch (e.kind) {
    case "sent":
      return job.status === "new" || job.status === "interesting" || job.status === "applying" ? { status: "applied", appliedAt: (e.at ?? "").slice(0, 10) || undefined } : {};
    case "interview_invite":
      return { status: job.status === "offer" ? undefined : "interview", nextStep: { text: e.text, date: e.date } };
    case "task":
      return { nextStep: { text: e.text, date: e.date } };
    case "rejection":
      return { status: "closed", closedReason: "rejected", nextStep: null };
    case "offer":
      return { status: "offer", nextStep: e.date ? { text: e.text, date: e.date } : undefined };
    default:
      return {};
  }
}

/**
 * Records what happened with applications (mostly e-mails Claude found) and moves the cards:
 * an invitation moves to Rozmowy with the date as the next step, a rejection closes, an offer moves to Oferta.
 */
export function logEvents(events: EventInput[], checkedUntil?: string, by: JobEvent["by"] = "claude"): Promise<Job[]> {
  return updateDb((db) => {
    const changed = events.map((e) => {
      const job = db.jobs[e.job_id];
      if (!job) throw new NotFound(`Nie ma oferty o id "${e.job_id}".`);
      const at = e.at ? new Date(e.at).toISOString() : new Date().toISOString();
      const duplicate = job.events?.some((x) => x.kind === e.kind && x.subject && x.subject === e.subject && x.at.slice(0, 10) === at.slice(0, 10));
      if (duplicate) return job;
      pushEvent(job, { at, kind: e.kind, text: e.text.trim(), by, from: e.from, subject: e.subject });
      const patch = eventPatch(e, job);
      if (patch.status === undefined) delete patch.status;
      // The event itself tells the story; no separate "status changed" entry.
      applyPatch(job, patch, new Date().toISOString(), by, false);
      return job;
    });
    if (checkedUntil) db.mailCheckedAt = new Date(checkedUntil).toISOString();
    return [...new Map(changed.map((j) => [j.id, j])).values()];
  });
}

/** Saves a tailored CV or cover letter (Markdown) on the offer; the board offers it as PDF and DOCX. */
export function saveDocument(jobId: string, kind: DocKind, markdown: string, language?: AppDoc["language"]): Promise<Job> {
  return updateDb((db) => {
    const job = db.jobs[jobId];
    if (!job) throw new NotFound(`Nie ma oferty o id "${jobId}".`);
    const text = markdown.trim();
    const docs = { ...job.documents };
    if (text) docs[kind] = { markdown: text, updatedAt: new Date().toISOString(), language: language ?? docs[kind]?.language };
    else delete docs[kind];
    job.documents = docs;
    job.updatedAt = new Date().toISOString();
    return job;
  });
}
