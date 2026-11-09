import type { NextRequest } from "next/server";
import { computeInsights } from "@/lib/insights";
import { handle } from "@/lib/server/route";
import { readDb, readProfile } from "@/lib/server/store";

/** ?days=30|90|0 (0 = everything collected). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const days = Number(req.nextUrl.searchParams.get("days") ?? 90);
    const profile = readProfile();
    const insights = computeInsights(Object.values(readDb().jobs), profile, { days: Number.isFinite(days) ? days : 90 });
    return { insights, minMonthlyPln: profile.minMonthlyPln ?? null };
  });
}
