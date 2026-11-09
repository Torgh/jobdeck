# JobDeck

Personal job-search board (IT, Poland). Next.js 16 app (`app/`, `components/`) + Bun MCP server (`mcp/server.ts`)
sharing one data folder (`JOBDECK_HOME`, see `lib/server/store.ts`). UI and tool output are in Polish.

- Model: `lib/types.ts`. Board logic (dedupe key, filters, todos, ordering): `lib/jobs.ts`. Salaries: `lib/salary.ts`.
- Portals: `lib/server/sources.ts` (Just Join IT, No Fluff Jobs APIs; LinkedIn guest search is opt-in).
  Pracuj.pl / theprotocol.it block automated requests: their offers come from e-mail alerts via `add_jobs`. Do not add
  scrapers that work around a portal's blocking.
- Scan + merge: `lib/server/ingest.ts`. Every write goes through `updateDb` / `updateProfile` (cross-process lock).
- `bun run check` before committing. Personal data (CV, offers) never goes into the repo.
