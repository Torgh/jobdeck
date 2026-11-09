import type { CompanyInfo, Job, Profile, ScanRecord } from "./types";
import type { Todo } from "./jobs";

/** What the board polls: jobs without their long descriptions, plus profile facts it needs. */
export interface BoardData {
  version: number;
  /** Server time of this snapshot, so the UI renders without reading the clock. */
  now: string;
  jobs: Job[];
  lastScan?: ScanRecord;
  todos: Todo[];
  /** Research of the employers on the board, by companyKey(). */
  companies: Record<string, CompanyInfo>;
  /** Until when Claude went through the mailbox for replies. */
  mailCheckedAt?: string;
  profile: Pick<Profile, "skills" | "keywords" | "onboarding"> & { cvFileName?: string; cvHash?: string; cvText?: string };
}

/** The profile as the settings page edits it: the CV text is only previewed. */
export type ProfileView = Omit<Profile, "cv"> & { cv?: { fileName: string; uploadedAt: string; chars: number; preview: string } };
