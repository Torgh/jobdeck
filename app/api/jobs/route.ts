import { todos } from "@/lib/jobs";
import { patchJobs, type JobPatch } from "@/lib/server/jobOps";
import { handle } from "@/lib/server/route";
import { readDb, readProfile } from "@/lib/server/store";
import type { BoardData } from "@/lib/view";

export async function GET() {
  return handle(async (): Promise<BoardData> => {
    const db = readDb();
    const profile = readProfile();
    const jobs = Object.values(db.jobs).map(({ description: _d, ...j }) => j);
    return {
      version: db.version,
      now: new Date().toISOString(),
      jobs,
      lastScan: db.scans.at(-1),
      todos: todos(jobs, profile.cv?.hash, Date.now(), db.companies),
      companies: db.companies ?? {},
      mailCheckedAt: db.mailCheckedAt,
      profile: {
        skills: profile.skills,
        keywords: profile.keywords,
        onboarding: profile.onboarding,
        cvFileName: profile.cv?.fileName,
        cvHash: profile.cv?.hash,
        // Lets the cards highlight the skills found in the CV.
        cvText: profile.cv?.text,
      },
    };
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const { ids, patch } = (await req.json()) as { ids: string[]; patch: JobPatch };
    return { jobs: await patchJobs(ids, patch) };
  });
}
