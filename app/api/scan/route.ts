import { scan } from "@/lib/server/ingest";
import { handle } from "@/lib/server/route";

export const maxDuration = 300;

export async function POST() {
  return handle(async () => {
    const r = await scan();
    return { added: r.added, skipped: r.skipped, results: r.results, since: r.since };
  });
}
