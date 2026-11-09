# JobDeck

Personal job-search board (IT, Poland). Next.js 16 app (`app/`, `components/`) + Bun MCP server (`mcp/server.ts`)
sharing one data folder (`JOBDECK_HOME`, see `lib/server/store.ts`). UI and tool output are in Polish.

- Model: `lib/types.ts`. Board logic (dedupe key, filters, todos, ordering): `lib/jobs.ts`. Salaries: `lib/salary.ts`.
- Portals: `lib/server/sources.ts` (Just Join IT, No Fluff Jobs APIs, Bulldogjob list page; opt-in: LinkedIn guest
  search, Remotive and Himalayas – Remotive's terms: link back, at most a few requests a day).
  Pracuj.pl / theprotocol.it block automated requests: their offers come from e-mail alerts via `add_jobs`. Do not add
  scrapers that work around a portal's blocking.
- Scan + merge: `lib/server/ingest.ts`. Every write goes through `updateDb` / `updateProfile` (cross-process lock).
- UI: `components/App.tsx` (views, onboarding) with the shared header `Nav.tsx` → `Today.tsx` (start screen: todos with
  actions, best new offers, side stats), `Inbox.tsx` (list + detail, keyboard) and `Pipeline.tsx` (stage list or
  kanban); `JobDetail.tsx` (tabs Dopasowanie / Oferta / Firma / Aplikacja) is shared. Icons: `Icon` in `ui.tsx`, no
  emoji in the UI chrome. Data hook with polling + undo: `components/api.ts`.
- Application history (`job.events`, `logEvents` in `lib/server/jobOps.ts`): e-mail events move cards; status
  changes made on the board are recorded too. Tailored docs (`job.documents`) are Markdown (`lib/markdown.ts`),
  rendered in `components/Markdown.tsx`, `/print` (A4 → PDF) and `lib/server/docx.ts`.
- Pay ("na rękę"): `lib/pay.ts` – yearly rules in `PL_2026` (update every January, with sources), user's B2B
  settings in `profile.pay`.
- Market page (`/insights`): numbers from `lib/insights.ts` (pure, tested), charts in `components/Market.tsx`
  (HTML/CSS; palette validated for light + dark, see `.viz-root` in globals.css).
- Stale offers: `staleness()` in `lib/jobs.ts` from `firstPublishedAt` / `refreshCount` (kept by `ingest`).
  Funnel stats: `computeFunnel()` in `lib/insights.ts`.
- Company research (`save_company_research`) is stored per `companyKey()` in `db.companies`.
- Follow-ups: `lib/followup.ts` (when due, max 2 reminders, gender-neutral PL/EN template; `follow_up` event).
  Interview prep is doc kind `prep`. Negotiation figures: `negotiation()` in `lib/insights.ts` (+ `job.offered`).
  Learning plan from Claude (`save_learning_plan`) in `db.learningPlan`, shown on `/insights`.
- `bun run check` before committing. Personal data (CV, offers) never goes into the repo.
