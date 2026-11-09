import { logEvents, type EventInput } from "@/lib/server/jobOps";
import { handle } from "@/lib/server/route";

/** { job_id, kind, text, date? } – an entry the user adds to an application's history on the board. */
export async function POST(req: Request) {
  return handle(async () => {
    const e = (await req.json()) as EventInput;
    const [job] = await logEvents([e], undefined, "app");
    return { job };
  });
}
