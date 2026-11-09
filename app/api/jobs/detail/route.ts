import type { NextRequest } from "next/server";
import { jobWithDescription } from "@/lib/server/jobOps";
import { handle } from "@/lib/server/route";

export async function GET(req: NextRequest) {
  return handle(async () => ({ job: await jobWithDescription(req.nextUrl.searchParams.get("id") ?? "") }));
}
