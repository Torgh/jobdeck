/**
 * The inbox against the current filters (phrases, contract, level, cities, salary):
 *   bun scripts/refilter.ts          list the new offers that do not fit
 *   bun scripts/refilter.ts --apply  remove them (untouched scan results only: no star, notes or history)
 */
import { refilterInbox } from "../lib/server/jobOps";

const apply = process.argv.includes("--apply");
const found = await refilterInbox(apply);
const byReason = new Map<string, number>();
for (const f of found) {
  const key = f.reason.replace(/\s*\(.*\)$/, "").replace(/^(lokalizacja|poziom|tryb) .*/, "$1");
  byReason.set(key, (byReason.get(key) ?? 0) + 1);
}
console.log(`${apply ? "Usunięto" : "Nie pasuje"}: ${found.length} nowych ofert.`);
for (const [r, n] of byReason) console.log(`  ${n} × ${r}`);
if (!apply && found.length) console.log("Usunięcie: bun run refilter -- --apply");
