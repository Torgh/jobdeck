/**
 * JobDeck MCP server: Claude Code / Claude Desktop scans the job portals, rates offers against the
 * user's CV and moves cards on the board, using the user's own subscription (no API key).
 * It reads and writes the same data folder as the web app (JOBDECK_HOME), so the board updates live.
 *
 *   claude mcp add --scope user jobdeck -e JOBDECK_HOME=<data dir> -- <path-to-bun> <repo>/mcp/server.ts
 */
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { compareJobs, seniorityFrom, todos } from "../lib/jobs";
import { formatSalary, parseSalaryText } from "../lib/salary";
import { saveCv } from "../lib/server/cv";
import { addJobs, scan } from "../lib/server/ingest";
import { jobWithDescription, patchJobs, rateJobs } from "../lib/server/jobOps";
import { readDb, readProfile, updateProfile } from "../lib/server/store";
import {
  CLOSED_LABEL,
  CLOSED_REASONS,
  CONTRACT_LABEL,
  SENIORITIES,
  SOURCE_LABEL,
  SOURCES,
  STATUS_LABEL,
  STATUSES,
  VERDICT_LABEL,
  WORK_MODE_LABEL,
  type Job,
  type Profile,
} from "../lib/types";

const INSTRUCTIONS = `JobDeck is the user's job-search board (IT jobs in Poland). Offers are cards in columns:
new → interesting → applying → applied → interview → offer, plus closed (with a reason). The user watches the board live
(http://127.0.0.1:3100), so make changes with the tools instead of only describing them. Refer to offers by job_id.

Routine ("co nowego?", run every second day or so):
1. get_overview – what is new, unrated, and what needs a follow-up.
2. scan_portals – Just Join IT and No Fluff Jobs APIs (plus LinkedIn's public search if the user turned it on), since the last scan.
3. LinkedIn & Pracuj.pl / theprotocol.it e-mail alerts – the main way their offers arrive (those portals block automated
   searches; never try to get around that). With Gmail tools, search the alerts since the last scan
   (from:jobalerts-noreply@linkedin.com OR from:jobs-listings@linkedin.com, from:pracuj.pl, from:theprotocol.it),
   read each offer's title, company, location and link, and add them with add_jobs (source linkedin / pracuj).
   Use the canonical link (https://www.linkedin.com/jobs/view/<id>) and the id as external_id. Never invent offers.
   No Gmail tools? Tell the user once that connecting Gmail lets you read the alerts.
4. Rate the new offers against the CV (below), then give the user a short ranked summary: the best ones first with
   one line each on why, and what you set aside. Move clear mismatches to closed (not_for_me) only if the user agrees,
   or when they asked you to triage.

Rating fit (rate_jobs):
- Read the CV and preferences once with get_profile, then each offer's full description with get_job.
- Score 0–100 from the evidence in the CV, not from guesses:
  must-have skills covered (~40), seniority & years of experience vs the role (~20), domain / type of work (~15),
  the user's preferences: work mode, location, contract, salary vs expectation, deal-breakers from "about" (~25).
- summary: 1–2 sentences in Polish, concrete ("5 lat Javy i Springa pokrywa core; brak Kafki i AWS").
- strengths / gaps: short Polish phrases naming the actual skill or requirement. A gap is something the offer requires
  that the CV does not show; say "nie widać w CV" when it may just be missing from the CV.
- 80+ strong, 65–79 good, 45–64 partial, <45 weak. Do not inflate: a realistic score is more useful.
- If the CV is missing, ask the user to upload it (Ustawienia on the board, or import_cv with a file path).
- Many new offers (more than ~25)? Triage first: from list_jobs (title, company, skills, stack match, salary) give the
  obvious mismatches a quick rating without opening them (summary starts with "Wstępnie:"), then open and rate properly
  only the promising ones. Suggest tightening the profile (keywords, cities, exclusions) when the noise is high.

Applying: when the user picks an offer, move it to applying, help tailor the CV / cover letter from the CV text
and the description, then to applied once sent (it records the date). Use next_step for interviews and follow-ups
("Rozmowa techniczna", date). get_overview lists follow-ups (no answer after 7 days) – suggest a short follow-up message.

Answer in the user's language (Polish). The board UI is in Polish.`;

const server = new McpServer({ name: "jobdeck", title: "JobDeck", version: "0.1.0" }, { instructions: INSTRUCTIONS });

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

function tool<A>(fn: (args: A) => Promise<string> | string): (args: A) => Promise<ToolResult> {
  return async (args) => {
    try {
      return text(await fn(args));
    } catch (e) {
      return { content: [{ type: "text", text: `Błąd: ${(e as Error).message}` }], isError: true };
    }
  };
}

const days = (iso?: string) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : undefined);

function oneLine(j: Job): string {
  const parts = [
    `[${j.id}] ${j.title} @ ${j.company}`,
    [j.workMode && WORK_MODE_LABEL[j.workMode], j.location].filter(Boolean).join(", "),
    j.salaries[0] ? formatSalary(j.salaries[0]) : "bez widełek",
    j.fit ? `fit ${j.fit.score}` : j.stackMatch != null ? `stack ${j.stackMatch}%` : "",
    j.links.map((l) => SOURCE_LABEL[l.source]).join("/"),
    j.publishedAt ? `${days(j.publishedAt)} d temu` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

function jobDetails(j: Job): string {
  const lines = [
    `# ${j.title} @ ${j.company}`,
    `id: ${j.id} · status: ${STATUS_LABEL[j.status]}${j.closedReason ? ` (${CLOSED_LABEL[j.closedReason]})` : ""}${j.starred ? " · ⭐" : ""}`,
    `Link: ${j.url}${j.links.length > 1 ? ` (też: ${j.links.slice(1).map((l) => l.url).join(", ")})` : ""}`,
    `Miejsce: ${[j.workMode && WORK_MODE_LABEL[j.workMode], j.location].filter(Boolean).join(", ") || "?"}`,
    `Poziom: ${j.seniority ?? "?"}`,
    `Wynagrodzenie: ${j.salaries.length ? j.salaries.map(formatSalary).join(" | ") : "nie podano"}`,
    j.skills.length ? `Wymagane: ${j.skills.join(", ")}` : "",
    j.niceSkills?.length ? `Mile widziane: ${j.niceSkills.join(", ")}` : "",
    j.stackMatch != null ? `Zgodność stacku z CV (słowa kluczowe): ${j.stackMatch}%` : "",
    `Opublikowana: ${j.publishedAt?.slice(0, 10) ?? "?"}${j.expiresAt ? ` · wygasa ${j.expiresAt.slice(0, 10)}` : ""}`,
    j.fit
      ? `Ocena: ${j.fit.score}/100 – ${VERDICT_LABEL[j.fit.verdict]}. ${j.fit.summary}\n  + ${j.fit.strengths.join("; ")}\n  − ${j.fit.gaps.join("; ")}`
      : "Ocena: brak",
    j.notes ? `Notatki: ${j.notes}` : "",
    j.nextStep ? `Następny krok: ${j.nextStep.text}${j.nextStep.date ? ` (${j.nextStep.date})` : ""}` : "",
    j.appliedAt ? `Wysłano: ${j.appliedAt}` : "",
    "",
    "## Opis",
    j.description ?? j.summary ?? "(brak)",
  ];
  return lines.filter((l) => l !== "").join("\n").replace("## Opis", "\n## Opis");
}

function profileText(p: Profile, includeCv: boolean): string {
  return [
    `Frazy wyszukiwania: ${p.keywords.join(", ") || "(brak – ustaw keywords)"}`,
    `Lokalizacje: ${p.locations.join(", ") || "cała Polska"} · tryb: ${p.workModes.map((m) => WORK_MODE_LABEL[m]).join(", ")}`,
    `Poziom: ${p.seniority.join(", ")} · umowy: ${p.contracts.map((c) => CONTRACT_LABEL[c]).join(", ")}`,
    `Oczekiwania: ${p.minMonthlyPln ? `min ${p.minMonthlyPln} PLN/mies.` : "nie podano"}`,
    `Wykluczone słowa: ${p.excludeKeywords.join(", ") || "-"} · firmy: ${p.excludeCompanies.join(", ") || "-"}`,
    `Źródła: ${SOURCES.filter((s) => p.sources[s]).map((s) => SOURCE_LABEL[s]).join(", ")}`,
    `Umiejętności (profil): ${p.skills.join(", ") || "-"}`,
    `O mnie / czego szukam: ${p.about || "-"}`,
    p.cv
      ? `CV: ${p.cv.fileName} (wgrane ${p.cv.uploadedAt.slice(0, 10)}, ${p.cv.text.length} znaków)${includeCv ? `\n\n## Treść CV\n${p.cv.text}` : ""}`
      : "CV: BRAK – poproś użytkownika o wgranie CV w Ustawieniach albo przez import_cv.",
  ].join("\n");
}

server.registerTool(
  "get_overview",
  {
    title: "Overview",
    description: "Board summary: cards per column, unrated new offers, the last scan, profile gaps and what needs attention (follow-ups, next steps, expiring offers).",
    inputSchema: {},
  },
  tool(async () => {
    const db = readDb();
    const profile = readProfile();
    const jobs = Object.values(db.jobs);
    const per = STATUSES.map((s) => `${STATUS_LABEL[s]}: ${jobs.filter((j) => j.status === s).length}`).join(" · ");
    const unrated = jobs.filter((j) => j.status === "new" && !j.fit);
    const last = db.scans.at(-1);
    const todo = todos(jobs, profile.cv?.hash);
    const missing = [
      !profile.cv && "brak CV",
      !profile.keywords.length && "brak fraz wyszukiwania",
      !profile.skills.length && "brak listy umiejętności (wyciągnij z CV i zapisz update_profile skills)",
    ].filter(Boolean);
    return [
      per,
      `Nowe bez oceny: ${unrated.length}`,
      last
        ? `Ostatni skan: ${last.at.slice(0, 16).replace("T", " ")} (${days(last.at)} d temu), dodano ${last.added}. ${last.results
            .map((r) => `${SOURCE_LABEL[r.source]} ${r.added}/${r.found}${r.error ? " ⚠ " + r.error : ""}`)
            .join(", ")}`
        : "Jeszcze nie skanowano.",
      missing.length ? `Do uzupełnienia w profilu: ${missing.join(", ")}` : "",
      todo.length ? `\nDo ogarnięcia:\n${todo.map((t) => `- [${t.jobId}] ${t.text}`).join("\n")}` : "Do ogarnięcia: nic.",
    ]
      .filter(Boolean)
      .join("\n");
  }),
);

server.registerTool(
  "get_profile",
  {
    title: "Get profile & CV",
    description: "The user's search preferences and the full text of their CV. Read it before rating offers.",
    inputSchema: { include_cv: z.boolean().optional().describe("Include the CV text (default true).") },
  },
  tool(async ({ include_cv }: { include_cv?: boolean }) => profileText(readProfile(), include_cv !== false)),
);

server.registerTool(
  "update_profile",
  {
    title: "Update profile",
    description:
      "Changes search preferences. Lists replace the old ones. skills = the user's skills as they appear in the CV (used for the quick stack match); about = what they look for and deal-breakers, in their words.",
    inputSchema: {
      keywords: z.array(z.string()).optional().describe('Search phrases sent to the portals, e.g. ["java", "kotlin"]. Short phrases work best.'),
      locations: z.array(z.string()).optional().describe("Cities; empty = whole Poland. Remote offers are always kept."),
      work_modes: z.array(z.enum(["remote", "hybrid", "office"])).optional(),
      seniority: z.array(z.enum(SENIORITIES as [string, ...string[]])).optional(),
      contracts: z.array(z.enum(["b2b", "uop", "uz", "other"])).optional(),
      min_monthly_pln: z.number().nullable().optional().describe("Expected minimum per month in PLN; offers clearly below are skipped by the scan."),
      exclude_keywords: z.array(z.string()).optional(),
      exclude_companies: z.array(z.string()).optional(),
      sources: z.record(z.enum(SOURCES), z.boolean()).optional().describe("Turn portals on/off."),
      skills: z.array(z.string()).optional(),
      about: z.string().optional(),
    },
  },
  tool(async (a: {
    keywords?: string[];
    locations?: string[];
    work_modes?: Profile["workModes"];
    seniority?: string[];
    contracts?: Profile["contracts"];
    min_monthly_pln?: number | null;
    exclude_keywords?: string[];
    exclude_companies?: string[];
    sources?: Partial<Profile["sources"]>;
    skills?: string[];
    about?: string;
  }) => {
    const p = await updateProfile((p) => {
      if (a.keywords) p.keywords = a.keywords;
      if (a.locations) p.locations = a.locations;
      if (a.work_modes) p.workModes = a.work_modes;
      if (a.seniority) p.seniority = a.seniority as Profile["seniority"];
      if (a.contracts) p.contracts = a.contracts;
      if (a.min_monthly_pln !== undefined) p.minMonthlyPln = a.min_monthly_pln ?? undefined;
      if (a.exclude_keywords) p.excludeKeywords = a.exclude_keywords;
      if (a.exclude_companies) p.excludeCompanies = a.exclude_companies;
      if (a.sources) p.sources = { ...p.sources, ...a.sources };
      if (a.skills) p.skills = a.skills;
      if (a.about !== undefined) p.about = a.about;
    });
    return `Zapisano.\n${profileText(p, false)}`;
  }),
);

server.registerTool(
  "import_cv",
  {
    title: "Import CV from a file",
    description: "Loads the user's CV from a local file (PDF, DOCX, TXT, MD) into JobDeck, replacing the previous one. The user can also upload it in the app (Ustawienia).",
    inputSchema: { path: z.string().describe("Absolute path to the CV file.") },
  },
  tool(async ({ path: p }: { path: string }) => {
    const cv = await saveCv(path.basename(p), new Uint8Array(fs.readFileSync(p)));
    return `CV wgrane: ${cv.fileName}, ${cv.text.length} znaków. Teraz wyciągnij z niego umiejętności i zapisz je przez update_profile skills.`;
  }),
);

server.registerTool(
  "scan_portals",
  {
    title: "Scan job portals",
    description: "Searches Just Join IT and No Fluff Jobs (and LinkedIn's public search if enabled) for the profile's keywords and adds offers published since the last scan (default) to the 'new' column, merging duplicates across portals. Takes up to a minute or two.",
    inputSchema: {
      sources: z.array(z.enum(SOURCES)).optional().describe("Only these portals (default: all enabled)."),
      keywords: z.array(z.string()).optional().describe("One-off phrases instead of the profile's."),
      days: z.number().int().min(1).max(30).optional().describe("Look back this many days instead of since the last scan."),
    },
  },
  tool(async (a: { sources?: Job["source"][]; keywords?: string[]; days?: number }) => {
    const r = await scan(a);
    const newest = [...r.newJobs].sort(compareJobs);
    return [
      `Skan od ${r.since.slice(0, 10)}: dodano ${r.added} nowych ofert, odfiltrowano ${r.skipped} (wykluczenia, poziom, lokalizacja, widełki).`,
      ...r.results.map((s) => `- ${SOURCE_LABEL[s.source]}: znaleziono ${s.found}, nowych ${s.added}${s.error ? ` ⚠ ${s.error}` : ""}`),
      newest.length ? `\nNowe:\n${newest.map((j) => `- ${oneLine(j)}`).join("\n")}` : "",
      newest.length ? "\nOceń je teraz: get_profile, potem get_job + rate_jobs." : "",
    ]
      .filter(Boolean)
      .join("\n");
  }),
);

server.registerTool(
  "add_jobs",
  {
    title: "Add offers",
    description: "Adds offers found elsewhere (LinkedIn / Pracuj.pl e-mail alerts, a link the user pasted). Duplicates of cards already on the board are merged. Offers the profile filters out are skipped unless force is true.",
    inputSchema: {
      jobs: z
        .array(
          z.object({
            title: z.string(),
            company: z.string(),
            url: z.string().url(),
            source: z.enum(SOURCES),
            external_id: z.string().optional().describe("LinkedIn job id (the number in /jobs/view/<id>)."),
            location: z.string().optional(),
            work_mode: z.enum(["remote", "hybrid", "office"]).optional(),
            salary_text: z.string().optional().describe('As written, e.g. "20 000–25 000 PLN brutto / mies." or "150-180 zł/h B2B".'),
            skills: z.array(z.string()).optional(),
            description: z.string().optional(),
            published_at: z.string().optional().describe("ISO date."),
          }),
        )
        .min(1),
      force: z.boolean().optional().describe("Add even if the profile filters would skip it (the user explicitly wants it)."),
    },
  },
  tool(async ({ jobs, force }: { jobs: {
    title: string; company: string; url: string; source: Job["source"]; external_id?: string; location?: string;
    work_mode?: Job["workMode"]; salary_text?: string; skills?: string[]; description?: string; published_at?: string;
  }[]; force?: boolean }) => {
    const r = await addJobs(
      jobs.map((j) => {
        const salary = j.salary_text ? parseSalaryText(j.salary_text) : undefined;
        const liId = j.url.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^/?]*-)?(\d+)/)?.[1];
        return {
          title: j.title,
          company: j.company,
          url: liId ? `https://www.linkedin.com/jobs/view/${liId}` : j.url,
          source: j.source,
          externalId: j.external_id ?? liId,
          location: j.location,
          workMode: j.work_mode,
          seniority: seniorityFrom(j.title),
          salaries: salary ? [salary] : [],
          skills: j.skills,
          description: j.description,
          publishedAt: j.published_at,
        };
      }),
      { force },
    );
    return [
      `Dodano ${r.added.length}, scalono z istniejącymi ${r.merged}, pominięto ${r.skipped.length}.`,
      ...r.added.map((j) => `+ ${oneLine(j)}`),
      ...r.skipped.map((s) => `– ${s.title} @ ${s.company}: ${s.reason}`),
    ].join("\n");
  }),
);

server.registerTool(
  "list_jobs",
  {
    title: "List offers",
    description: "Offers on the board, best first (score, stack match, newest). Filter by column, rating, source or text.",
    inputSchema: {
      status: z.array(z.enum(STATUSES)).optional().describe("Columns (default: all except closed)."),
      unrated: z.boolean().optional().describe("Only offers without a fit rating."),
      min_score: z.number().optional(),
      source: z.enum(SOURCES).optional(),
      query: z.string().optional().describe("Text in title, company or skills."),
      limit: z.number().int().min(1).max(200).optional().describe("Default 40."),
    },
  },
  tool(async (a: { status?: Job["status"][]; unrated?: boolean; min_score?: number; source?: Job["source"]; query?: string; limit?: number }) => {
    const q = a.query?.toLowerCase();
    const list = Object.values(readDb().jobs)
      .filter((j) => (a.status ? a.status.includes(j.status) : j.status !== "closed"))
      .filter((j) => !a.unrated || !j.fit)
      .filter((j) => a.min_score == null || (j.fit?.score ?? -1) >= a.min_score)
      .filter((j) => !a.source || j.links.some((l) => l.source === a.source))
      .filter((j) => !q || `${j.title} ${j.company} ${j.skills.join(" ")}`.toLowerCase().includes(q))
      .sort(compareJobs);
    const shown = list.slice(0, a.limit ?? 40);
    if (!shown.length) return "Brak ofert spełniających warunki.";
    const groups = STATUSES.map((s) => [s, shown.filter((j) => j.status === s)] as const).filter(([, js]) => js.length);
    return (
      groups.map(([s, js]) => `## ${STATUS_LABEL[s]} (${js.length})\n${js.map((j) => `- ${oneLine(j)}`).join("\n")}`).join("\n\n") +
      (list.length > shown.length ? `\n\n…i ${list.length - shown.length} więcej (zwiększ limit lub zawęź filtr).` : "")
    );
  }),
);

server.registerTool(
  "get_job",
  {
    title: "Get offer",
    description: "One offer with its full description (fetched from the portal the first time), salary, skills, rating, notes.",
    inputSchema: { job_id: z.string() },
  },
  tool(async ({ job_id }: { job_id: string }) => jobDetails(await jobWithDescription(job_id))),
);

server.registerTool(
  "rate_jobs",
  {
    title: "Save fit ratings",
    description: "Saves your fit assessment (CV vs offer) for one or more offers; the board shows the score, summary, strengths and gaps. Follow the rating rules in the server instructions.",
    inputSchema: {
      ratings: z
        .array(
          z.object({
            job_id: z.string(),
            score: z.number().min(0).max(100),
            summary: z.string().describe("1–2 sentences in Polish."),
            strengths: z.array(z.string()).describe("What in the CV matches the offer."),
            gaps: z.array(z.string()).describe("What the offer requires that the CV does not show."),
          }),
        )
        .min(1),
    },
  },
  tool(async ({ ratings }: { ratings: Parameters<typeof rateJobs>[0] }) => {
    const jobs = await rateJobs(ratings);
    return `Zapisano ${jobs.length} ocen:\n${jobs.map((j) => `- ${j.fit!.score} ${j.title} @ ${j.company}`).join("\n")}`;
  }),
);

server.registerTool(
  "update_job",
  {
    title: "Update offers",
    description:
      "Moves offers between columns and edits their notes, star and next step. Several job_ids get the same change (e.g. close many as not_for_me).",
    inputSchema: {
      job_ids: z.array(z.string()).min(1),
      status: z.enum(STATUSES).optional(),
      closed_reason: z.enum(CLOSED_REASONS).optional().describe("With status closed."),
      notes: z.string().optional().describe("Replaces the notes; empty clears them."),
      starred: z.boolean().optional(),
      next_step: z
        .object({ text: z.string(), date: z.string().optional().describe("YYYY-MM-DD") })
        .nullable()
        .optional()
        .describe("null clears it."),
      applied_at: z.string().optional().describe("YYYY-MM-DD, when the application was sent."),
    },
  },
  tool(async (a: {
    job_ids: string[];
    status?: Job["status"];
    closed_reason?: Job["closedReason"];
    notes?: string;
    starred?: boolean;
    next_step?: { text: string; date?: string } | null;
    applied_at?: string;
  }) => {
    const jobs = await patchJobs(a.job_ids, {
      status: a.status,
      closedReason: a.closed_reason,
      notes: a.notes,
      starred: a.starred,
      nextStep: a.next_step,
      appliedAt: a.applied_at,
    });
    return `Zaktualizowano:\n${jobs.map((j) => `- ${oneLine(j)} → ${STATUS_LABEL[j.status]}`).join("\n")}`;
  }),
);

await server.connect(new StdioServerTransport());
