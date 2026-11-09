import { DOC_LABEL, type DocKind, type Job } from "./types";

/** "CV – Allegro – Senior Kotlin Developer", safe as a file name. */
export function docTitle(job: Pick<Job, "company" | "title">, kind: DocKind): string {
  return `${DOC_LABEL[kind]} – ${job.company} – ${job.title}`.replace(/[\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").slice(0, 120).trim();
}
