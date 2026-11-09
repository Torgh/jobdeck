/**
 * Scan from the command line (or Windows Task Scheduler), without Claude:
 *   bun scripts/scan.ts            since the last scan
 *   bun scripts/scan.ts --days 7   the last 7 days
 * Rating the new offers happens later in Claude ("co nowego?").
 */
import { SOURCE_LABEL } from "../lib/types";
import { scan } from "../lib/server/ingest";

const i = process.argv.indexOf("--days");
const days = i > 0 ? Number(process.argv[i + 1]) : undefined;
const r = await scan({ days });
console.log(`Skan od ${r.since.slice(0, 10)}: ${r.added} nowych, ${r.skipped} odfiltrowanych.`);
for (const s of r.results) console.log(`  ${SOURCE_LABEL[s.source]}: ${s.added}/${s.found}${s.error ? `  ⚠ ${s.error}` : ""}`);
