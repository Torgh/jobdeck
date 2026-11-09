import { addDemo, demoCount, removeDemo } from "@/lib/demo";
import { handle } from "@/lib/server/route";
import { readDb, updateDb } from "@/lib/server/store";

/** How many test offers are on the board. */
export async function GET() {
  return handle(async () => ({ count: demoCount(readDb()) }));
}

/** Loads the test data (again, with fresh dates). */
export async function POST() {
  return handle(async () => ({ count: await updateDb((db) => addDemo(db)) }));
}

/** Removes the test data and only it. */
export async function DELETE() {
  return handle(async () => ({ removed: await updateDb((db) => removeDemo(db)), count: 0 }));
}
