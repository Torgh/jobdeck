import { handle } from "@/lib/server/route";
import { readProfile, updateProfile } from "@/lib/server/store";
import type { Profile } from "@/lib/types";
import type { ProfileView } from "@/lib/view";

function view(p: Profile): ProfileView {
  const { cv, ...rest } = p;
  return {
    ...rest,
    cv: cv && { fileName: cv.fileName, uploadedAt: cv.uploadedAt, chars: cv.text.length, preview: cv.text.slice(0, 4000) },
  };
}

export async function GET() {
  return handle(async () => view(readProfile()));
}

const EDITABLE = [
  "keywords", "locations", "modeLocations", "workModes", "seniority", "contracts", "minMonthlyPln",
  "excludeKeywords", "excludeCompanies", "sources", "skills", "about", "onboarding", "pay",
] as const;

export async function PUT(req: Request) {
  return handle(async () => {
    const body = (await req.json()) as Partial<Profile>;
    const p = await updateProfile((p) => {
      for (const k of EDITABLE) if (k in body) (p as unknown as Record<string, unknown>)[k] = body[k];
    });
    return view(p);
  });
}
