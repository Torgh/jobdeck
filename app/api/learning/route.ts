import { setLearningDone } from "@/lib/server/jobOps";
import { handle } from "@/lib/server/route";

/** { skill, done } – the user ticks a skill of the learning plan off on the Market page. */
export async function PUT(req: Request) {
  return handle(async () => {
    const { skill, done } = (await req.json()) as { skill?: unknown; done?: unknown };
    if (typeof skill !== "string" || !skill.trim()) throw new SyntaxError("Podaj umiejętność.");
    return { plan: await setLearningDone(skill, done === true) };
  });
}
