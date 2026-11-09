/**
 * Test data on the board, from the command line:
 *   bun scripts/demo.ts          load (again) – fictional companies marked as test data
 *   bun scripts/demo.ts --clear  remove the test data; real offers, profile and CV stay
 */
import { addDemo, removeDemo } from "../lib/demo";
import { updateDb } from "../lib/server/store";

if (process.argv.includes("--clear")) {
  const n = await updateDb((db) => removeDemo(db));
  console.log(`Usunięto dane testowe: ${n} ofert.`);
} else {
  const n = await updateDb((db) => addDemo(db));
  console.log(`Wczytano dane testowe: ${n} ofert. Usuniesz je: bun run demo:clear albo w Ustawieniach.`);
}
