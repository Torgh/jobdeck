import type { Job, Profile, ScanRecord } from "./types";
import type { Todo } from "./jobs";

/** What the board polls: jobs without their long descriptions, plus profile facts it needs. */
export interface BoardData {
  version: number;
  jobs: Job[];
  lastScan?: ScanRecord;
  todos: Todo[];
  profile: Pick<Profile, "skills" | "keywords"> & { cvFileName?: string; cvHash?: string; cvText?: string };
}

/** The profile as the settings page edits it: the CV text is only previewed. */
export type ProfileView = Omit<Profile, "cv"> & { cv?: { fileName: string; uploadedAt: string; chars: number; preview: string } };
