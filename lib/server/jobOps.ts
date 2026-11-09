import { companyKey } from "../jobs";
import type { ClosedReason, CompanyInfo, Fit, Job, Status, Verdict } from "../types";
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

export function applyPatch(job: Job, patch: JobPatch, now = new Date().toISOString()) {
  if (patch.status && patch.status !== job.status) {
    job.status = patch.status;
    job.statusChangedAt = now;
    if (patch.status === "applied" && !job.appliedAt) job.appliedAt = now.slice(0, 10);
    if (patch.status !== "closed") delete job.closedReason;
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
