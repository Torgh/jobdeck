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
import { followUpState } from "../lib/followup";
import { computeFunnel, computeInsights, negotiation, POSITION_LABEL } from "../lib/insights";
import { citiesFor, compareJobs, companyResearch, seniorityFrom, staleness, todos } from "../lib/jobs";
import { b2bEquivalent, b2bNet, formatOnHand, onHandRange, paySettings, TAX_FORM_LABEL, uopNet, ZUS_LABEL, type B2bSettings } from "../lib/pay";
import { formatSalary, parseSalaryText } from "../lib/salary";
import { saveCv } from "../lib/server/cv";
import { addJobs, scan } from "../lib/server/ingest";
import { jobWithDescription, logEvents, patchJobs, rateJobs, refilterInbox, saveCompany, saveDocument, saveLearningPlan } from "../lib/server/jobOps";
import { readDb, readProfile, updateProfile } from "../lib/server/store";
import {
  CLOSED_LABEL,
  CLOSED_REASONS,
  CONTRACT_LABEL,
  DOC_KINDS,
  DOC_LABEL,
  EVENT_LABEL,
  SENIORITIES,
  SENIORITY_LABEL,
  SOURCE_LABEL,
  SOURCES,
  STATUS_LABEL,
  STATUSES,
  VERDICT_LABEL,
  WORK_MODE_LABEL,
  type CompanyInfo,
  type Job,
  type LearningPlan,
  type Profile,
} from "../lib/types";

const INSTRUCTIONS = `JobDeck is the user's job-search board (IT jobs in Poland). Offers are cards in columns:
new → interesting → applying → applied → interview → offer, plus closed (with a reason). The user watches the board live
(http://127.0.0.1:3100), so make changes with the tools instead of only describing them. Refer to offers by job_id.

Routine ("co nowego?", run every second day or so):
1. get_overview – what is new, unrated, and what needs a follow-up.
2. scan_portals – Just Join IT, No Fluff Jobs and Bulldogjob (plus, if the user turned them on, LinkedIn's public search
   and the remote boards from abroad Remotive and Himalayas – only offers open to Poland / Europe), since the last scan.
3. LinkedIn & Pracuj.pl / theprotocol.it e-mail alerts – the main way their offers arrive (those portals block automated
   searches; never try to get around that). With Gmail tools, search the alerts since the last scan
   (from:jobalerts-noreply@linkedin.com OR from:jobs-listings@linkedin.com, from:pracuj.pl, from:theprotocol.it),
   read each offer's title, company, location and link, and add them with add_jobs (source linkedin / pracuj).
   Use the canonical link (https://www.linkedin.com/jobs/view/<id>) and the id as external_id. Never invent offers.
   No Gmail tools? Tell the user once that connecting Gmail lets you read the alerts.
4. Rate the new offers against the CV (below), then give the user a short ranked summary: the best ones first with
   one line each on why, and what you set aside. Move clear mismatches to closed (not_for_me) only if the user agrees,
   or when they asked you to triage.
5. Research the employers get_overview lists under "Sprawdź firmę" (offers the user marked as interesting or further).
6. Replies from employers (Gmail): see "Mail" below.

Mail – replies from employers (log_events), when you have Gmail tools:
- get_overview lists the applications to watch and the date the mailbox was last checked. Search from that date
  (minus a day) for each company's name and domain, and for recruiting systems that send on their behalf
  (greenhouse, lever, workable, teamtailor, smartrecruiters, recruitee, personio, erecruiter, pracuj.pl "Twoja aplikacja",
  LinkedIn "Your application was sent / viewed"), in Polish and English.
- Classify each relevant message: sent (confirmation that the application arrived), reply (any other answer),
  interview_invite (with the date as date, and "Rozmowa …" as text), task (home assignment, deadline as date),
  rejection, offer. One event per message; text = one Polish sentence with the substance; from and subject so the
  user can find it. The board then moves the card (invite → Rozmowy, rejection → Zamknięte, offer → Oferta).
- Only messages clearly about one of the user's applications; when unsure which offer it is, ask. Never invent dates.
- Always pass checked_until (now) when you went through the mailbox, even if nothing was found.
- Report the findings briefly; suggest replies (e.g. confirming an interview slot) but do not send e-mails yourself.

Tailored CV and cover letter (save_document), when the user applies or asks:
- From get_profile (CV text, about) and get_job (description, fit gaps, company research). Write in the offer's
  language (Polish offer → Polish, English → English).
- CV: the user's real experience only – never invent skills, employers, dates, numbers or certificates. Tailor by
  ordering and emphasis: a 2–3 line profile aimed at this role, the most relevant experience and achievements first,
  the offer's keywords where the CV truthfully supports them (ATS), less relevant parts shortened. Keep contact data
  from the CV. Markdown: "# Name", contact line, "## Section" headings, "- " bullets, **bold**. 1–2 pages.
- Cover letter: max ~250 words, concrete: why this company (use the research), 2–3 matching achievements, what the
  user wants to build there. No clichés, no repeating the CV. Same Markdown subset; greeting and sign-off with the name.
- If something important is missing in the CV for this offer, say so to the user instead of filling it in.
- The board shows the documents with PDF (print view) and DOCX downloads; the user may edit them there.

Interview preparation (save_document kind "prep"), when a card reaches interview (get_overview lists "Przygotuj się do
rozmowy") or the user asks:
- From get_job (description, requirements, fit gaps, company research, history – who invited and for what kind of
  interview) and get_profile (CV). Write in Polish unless the interview is in English (then English).
- Sections ("## …"): Rozmowa (type, date, who, if known from the history); Pytania techniczne – 8–12 likely questions from
  the offer's stack and level, each with a short hint of what a good answer covers; Twoje przykłady – 3–4 stories from
  the CV in STAR form (sytuacja, zadanie, działanie, rezultat) mapped to the offer's requirements, only real experience;
  Braki i jak o nich mówić – the fit gaps, honestly framed (what is adjacent, how fast the user learns it);
  Pytania do firmy – 5–7 questions, using the research flags (e.g. turnover, end client, re-posted offer);
  Wynagrodzenie – the figure from the negotiation section of get_job and how to phrase it; Na koniec – a short checklist.
- Never invent the user's experience or numbers. Update the doc (get_document first) after each round if the user
  tells you how it went.

Follow-ups: get_overview lists applications without an answer (7+ days of silence, at most 2 reminders; after that it
suggests closing). The board has a ready template; when the user asks you to write one, make it short (max 120 words),
in the offer's language, gender-neutral in Polish, with one concrete point of fit from the rating – not pushy. Do not
send it yourself. When you find in Gmail that the user sent a reminder, log it with log_events kind follow_up.

Negotiation (interview / offer stage), when the user asks about money or gets an offer:
- get_job shows a "Negocjacje" section: the company's proposal (update_job offered, when the user or an e-mail names an
  amount), the published range, the market for the level from the collected offers and a suggested figure with reasons.
  Use compare_pay for "na rękę" and B2B / UoP equivalents.
- Give the user: the figure to name (and a walk-away minimum), 2–3 arguments from their CV and the market, phrasing in
  Polish for "jakie są Pana/Pani oczekiwania?" and for a counter-offer, and what else to negotiate (B2B: paid days off,
  notice period, equipment, rate review; UoP: bonus, 50% KUP for creative work, remote, training budget).
- Say that the market numbers cover only offers JobDeck collected. Never invent other companies' offers.

Learning plan (save_learning_plan), when the user asks what to learn or the plan is missing / older than ~2 months:
- From get_market_insights: the recurring gaps and the most requested skills missing from the CV, weighted towards
  offers rated 65+ (the ones within reach). Pick 3–5; skip what the CV may just be missing (ask the user instead).
- For each: why (numbers: "w 9 z 31 ocenionych ofert, w tym 5 z oceną 65+"), one small project that would prove it in the
  CV / on GitHub and fits the user's stack (concrete: what to build, which part shows the skill), effort, and 1–3
  resources – official docs or well-known free courses; only links you have checked exist.

Company research (save_company_research), with your web search / fetch tools:
- What the company does, product company vs software house vs body leasing / outsourcing vs recruitment agency
  (then who the end client is, if the offer says), size and headcount in Poland, recent news (layoffs, funding,
  acquisitions, restructuring) from the last 12–18 months.
- Opinions: GoWork.pl (most Polish employee reviews), Glassdoor, Indeed, Reddit (r/Polska, r/cscareerquestionsEU),
  4programmers.net, Wykop. Ratings only as published on the site, with the number of reviews and the link;
  never estimate a rating. Summarise recurring themes into pros / cons (short Polish phrases), not single reviews.
- flags: what to check or ask in the interview (e.g. "częste zwolnienia w 2026", "oferta wystawiana od miesięcy",
  "klient końcowy nieznany"). sources: the pages you used. If you found little, say so in the summary.
- One research per company; it is shown on every offer from that company.

Rating fit (rate_jobs):
- Read the CV and preferences once with get_profile, then each offer's full description with get_job.
- Score 0–100 from the evidence in the CV, not from guesses:
  must-have skills covered (~40), seniority & years of experience vs the role (~20), domain / type of work (~15),
  the user's preferences: work mode, location, contract, salary vs expectation, deal-breakers from "about" (~25).
- summary: 1–2 sentences in Polish, concrete ("5 lat Javy i Springa pokrywa core; brak Kafki i AWS").
- strengths / gaps: short Polish phrases naming the actual skill or requirement. A gap is something the offer requires
  that the CV does not show; say "nie widać w CV" when it may just be missing from the CV.
- 80+ strong, 65–79 good, 45–64 partial, <45 weak. Do not inflate: a realistic score is more useful.
- An offer marked "⚠ … oferta-widmo" (listed for months or re-published again and again) may not really be filled:
  say so in the summary and suggest asking the recruiter whether the process is open before investing time.
- If the CV is missing, ask the user to upload it (Ustawienia on the board, or import_cv with a file path).
- Many new offers (more than ~25)? Triage first: from list_jobs (title, company, skills, stack match, salary) give the
  obvious mismatches a quick rating without opening them (summary starts with "Wstępnie:"), then open and rate properly
  only the promising ones. Suggest tightening the profile (keywords, cities, exclusions) when the noise is high.

Applying: when the user picks an offer, move it to applying, help tailor the CV / cover letter from the CV text
and the description, then to applied once sent (it records the date). Use next_step for interviews and follow-ups
("Rozmowa techniczna", date). get_overview lists follow-ups (no answer after 7 days) – suggest a short follow-up message.

Market (get_market_insights): when the user asks what the market says, what to learn, what to ask for or which
portals are worth it – interpret the numbers: where their expectation sits against the medians for their level,
which missing skills recur in good offers (and how hard each would be to show), which sources lead to interviews.
It covers only the offers JobDeck collected (their keywords and filters), not the whole market – say so.

Answer in the user's language (Polish). The board UI is in Polish.`;

const server = new McpServer({ name: "jobdeck", title: "JobDeck", version: "0.4.0" }, { instructions: INSTRUCTIONS });

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
    `${j.demo ? "[TEST] " : ""}[${j.id}] ${j.title} @ ${j.company}`,
    [j.workMode && WORK_MODE_LABEL[j.workMode], j.location].filter(Boolean).join(", "),
    j.salaries[0] ? formatSalary(j.salaries[0]) : "bez widełek",
    j.fit ? `fit ${j.fit.score}` : j.stackMatch != null ? `stack ${j.stackMatch}%` : "",
    j.links.map((l) => SOURCE_LABEL[l.source]).join("/"),
    j.publishedAt ? `${days(j.publishedAt)} d temu` : "",
    staleness(j)?.level === "ghost" ? `⚠ ${staleness(j)!.text}` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** "Na rękę: ≈ 14,9–17,3k na rękę (B2B)" with the user's B2B settings, or "" when it cannot be estimated. */
function onHand(j: Job): string {
  const s = paySettings(readProfile().pay);
  const parts = j.salaries
    .map((sal) => {
      const r = onHandRange(sal, s);
      return r && `${formatOnHand(r)} (${sal.contract === "b2b" ? "B2B" : "UoP"})`;
    })
    .filter(Boolean);
  return parts.length ? `Na rękę (szacunek 2026, ustawienia użytkownika): ${parts.join(" | ")}` : "";
}

function payText(s: B2bSettings): string {
  return `${TAX_FORM_LABEL[s.form]}${s.form === "ryczalt" ? ` ${s.ryczaltRate}%` : ""}, ${ZUS_LABEL[s.zus]}${s.sickness ? " + chorobowe" : ""}, koszty ${s.costsMonthly} zł/mies., dni bez wynagrodzenia: ${s.unpaidDays}`;
}

function funnelText(): string {
  const f = computeFunnel(Object.values(readDb().jobs));
  const pc = (v?: number) => (v == null ? "–" : `${Math.round(v * 100)}%`);
  return [
    `\nLejek użytkownika: ${f.stages.map((s) => `${s.label} ${s.count}`).join(" → ")}`,
    `Odpowiedzi: ${pc(f.responseRate)} · rozmowy: ${pc(f.interviewRate)}${f.medianDaysToAnswer != null ? ` · mediana czasu do odpowiedzi ${f.medianDaysToAnswer} d` : ""} · bez odpowiedzi > 14 dni: ${f.noAnswer}`,
    `Wysłane tygodniowo (8 tyg.): ${f.weekly.map((w) => w.applied).join(", ")}`,
  ].join("\n");
}

function learningText(plan?: LearningPlan): string {
  if (!plan?.items.length) return "\nPlan nauki: brak (save_learning_plan).";
  return [
    `\nPlan nauki (z ${plan.createdAt.slice(0, 10)}${plan.basedOn ? `, ${plan.basedOn}` : ""}):`,
    ...plan.items.map((i) => `- ${i.done ? "✓ " : ""}${i.skill}${i.effort ? ` (${i.effort})` : ""}: ${i.project}`),
  ].join("\n");
}

function companyText(c: CompanyInfo): string {
  return [
    `## Firma: ${c.name} (research ${c.researchedAt.slice(0, 10)})`,
    c.summary,
    [c.kind, c.industry, c.size, c.website].filter(Boolean).join(" · "),
    c.ratings.length
      ? `Oceny: ${c.ratings.map((r) => `${r.site} ${r.score}/${r.outOf}${r.reviews ? ` (${r.reviews} opinii)` : ""}`).join(", ")}`
      : "",
    c.pros.length ? `+ ${c.pros.join("; ")}` : "",
    c.cons.length ? `− ${c.cons.join("; ")}` : "",
    c.flags.length ? `⚑ ${c.flags.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const zl = (v: number) => `${Math.round(v).toLocaleString("pl-PL")} zł`;

/** Interview / offer stage: the figures for the salary talk. */
function negotiationText(j: Job): string {
  if (j.status !== "interview" && j.status !== "offer") return "";
  const profile = readProfile();
  const bands = computeInsights(Object.values(readDb().jobs), profile, { days: 180 }).salary;
  const rows = negotiation(j, bands, { minMonthly: profile.minMonthlyPln });
  if (!rows.length) return "\n## Negocjacje\nBrak widełek i za mało ofert z widełkami – zapytaj użytkownika o propozycję firmy (update_job offered) i użyj compare_pay.";
  return [
    "\n## Negocjacje (rynek z ofert JobDeck, 180 dni)",
    ...rows.map((n) =>
      [
        `${n.contract === "b2b" ? "B2B netto" : "UoP brutto"}:`,
        n.offered != null ? `  propozycja firmy ${zl(n.offered)}` : "",
        n.range ? `  widełki ${n.range.min != null ? zl(n.range.min) : "?"}–${n.range.max != null ? zl(n.range.max) : "?"}` : "",
        n.band ? `  rynek (${n.band.seniority}): mediana ${zl(n.band.median)}, 25–75%: ${zl(n.band.p25)}–${zl(n.band.p75)}, n=${n.band.n}` : "",
        n.position ? `  pozycja: ${POSITION_LABEL[n.position]}` : "",
        `  sugerowana kwota: ${zl(n.ask)}`,
        ...n.reasons.map((r) => `  - ${r}`),
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n");
}

function followUpText(j: Job): string {
  const f = followUpState(j);
  if (!f) return "";
  return `Follow-up: ${f.quietDays} d bez odpowiedzi, wysłano przypomnień: ${f.count}${f.due ? " – czas się przypomnieć" : f.giveUp ? " – rozważ zamknięcie" : ""}`;
}

function jobDetails(j: Job, company?: CompanyInfo): string {
  const lines = [
    `# ${j.title} @ ${j.company}`,
    `id: ${j.id} · status: ${STATUS_LABEL[j.status]}${j.closedReason ? ` (${CLOSED_LABEL[j.closedReason]})` : ""}${j.starred ? " · ⭐" : ""}`,
    `Na tablicy: http://127.0.0.1:3100/?job=${j.id}`,
    `Link: ${j.url}${j.links.length > 1 ? ` (też: ${j.links.slice(1).map((l) => l.url).join(", ")})` : ""}`,
    `Miejsce: ${[j.workMode && WORK_MODE_LABEL[j.workMode], j.location].filter(Boolean).join(", ") || "?"}`,
    `Poziom: ${j.seniority ?? "?"}`,
    `Wynagrodzenie: ${j.salaries.length ? j.salaries.map(formatSalary).join(" | ") : "nie podano"}`,
    onHand(j),
    j.skills.length ? `Wymagane: ${j.skills.join(", ")}` : "",
    j.niceSkills?.length ? `Mile widziane: ${j.niceSkills.join(", ")}` : "",
    j.stackMatch != null ? `Zgodność stacku z CV (słowa kluczowe): ${j.stackMatch}%` : "",
    `Opublikowana: ${j.publishedAt?.slice(0, 10) ?? "?"}${j.firstPublishedAt && j.firstPublishedAt.slice(0, 10) !== j.publishedAt?.slice(0, 10) ? ` (pierwszy raz ${j.firstPublishedAt.slice(0, 10)})` : ""}${j.expiresAt ? ` · wygasa ${j.expiresAt.slice(0, 10)}` : ""}`,
    staleness(j) ? `⚠ ${staleness(j)!.text}` : "",
    j.fit
      ? `Ocena: ${j.fit.score}/100 – ${VERDICT_LABEL[j.fit.verdict]}. ${j.fit.summary}\n  + ${j.fit.strengths.join("; ")}\n  − ${j.fit.gaps.join("; ")}`
      : "Ocena: brak",
    j.notes ? `Notatki: ${j.notes}` : "",
    j.nextStep ? `Następny krok: ${j.nextStep.text}${j.nextStep.date ? ` (${j.nextStep.date})` : ""}` : "",
    j.appliedAt ? `Wysłano: ${j.appliedAt}` : "",
    followUpText(j),
    j.events?.length ? `Historia:\n${j.events.map((e) => `  ${e.at.slice(0, 10)} ${EVENT_LABEL[e.kind]}: ${e.text}${e.subject ? ` [${e.subject}]` : ""}`).join("\n")}` : "",
    `Dokumenty: ${DOC_KINDS.filter((k) => j.documents?.[k]).map((k) => `${DOC_LABEL[k]} (${j.documents![k]!.updatedAt.slice(0, 10)})`).join(", ") || "brak"}`,
    company ? `\n${companyText(company)}` : "Firma: brak researchu (save_company_research).",
    negotiationText(j),
    "",
    "## Opis",
    j.description ?? j.summary ?? "(brak)",
  ];
  return lines.filter((l) => l !== "").join("\n").replace("## Opis", "\n## Opis");
}

function profileText(p: Profile, includeCv: boolean): string {
  return [
    `Frazy wyszukiwania: ${p.keywords.join(", ") || "(brak – ustaw keywords)"}`,
    `Tryb i miasta: ${p.workModes.map((m) => (m === "remote" ? `${WORK_MODE_LABEL[m]} (cała Polska)` : `${WORK_MODE_LABEL[m]} (${citiesFor(p, m).join(", ") || "cała Polska"})`)).join(" · ") || "-"}`,
    `Poziom: ${p.seniority.join(", ")} · umowy: ${p.contracts.map((c) => CONTRACT_LABEL[c]).join(", ")}`,
    `Oczekiwania: ${p.minMonthlyPln ? `min ${p.minMonthlyPln} PLN/mies.` : "nie podano"}`,
    `Wykluczone słowa: ${p.excludeKeywords.join(", ") || "-"} · firmy: ${p.excludeCompanies.join(", ") || "-"}`,
    `Źródła: ${SOURCES.filter((s) => p.sources[s]).map((s) => SOURCE_LABEL[s]).join(", ")}`,
    `Umiejętności (profil): ${p.skills.join(", ") || "-"}`,
    `O mnie / czego szukam: ${p.about || "-"}`,
    `Rozliczenie B2B (do kwot „na rękę”): ${payText(paySettings(p.pay))}${p.pay?.commuting ? "; UoP: dojazd z innej miejscowości" : ""}`,
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
    const todo = todos(jobs, profile.cv?.hash, Date.now(), db.companies);
    const watch = jobs.filter((j) => !j.demo && (["applied", "interview", "offer"].includes(j.status) || (j.status === "applying" && j.appliedAt)));
    const demo = jobs.filter((j) => j.demo).length;
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
      demo
        ? `Dane testowe na tablicy: ${demo} ofert [TEST] fikcyjnych firm – nie oceniaj ich, nie szukaj ich w Gmailu ani w sieci. Usunięcie: Ustawienia → Dane testowe albo bun run demo:clear.`
        : "",
      todo.length ? `\nDo ogarnięcia:\n${todo.map((t) => `- [${t.jobId}] ${t.text}`).join("\n")}` : "Do ogarnięcia: nic.",
      watch.length
        ? `\nMail – aplikacje do obserwowania (sprawdzono skrzynkę: ${db.mailCheckedAt ? db.mailCheckedAt.slice(0, 16).replace("T", " ") : "nigdy"}):\n${watch
            .map((j) => `- [${j.id}] ${j.company} – ${j.title} · ${STATUS_LABEL[j.status]}${j.appliedAt ? ` · wysłano ${j.appliedAt}` : ""}`)
            .join("\n")}`
        : "",
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
      locations: z.array(z.string()).optional().describe("Cities for every on-site mode without its own list; empty = whole Poland. Remote offers are always kept."),
      mode_locations: z
        .object({ hybrid: z.array(z.string()).optional(), office: z.array(z.string()).optional() })
        .optional()
        .describe('Cities per mode, e.g. {"hybrid": ["Wrocław"]} = hybrid only in Wrocław; [] = whole Poland. Remote is never limited.'),
      work_modes: z.array(z.enum(["remote", "hybrid", "office"])).optional(),
      seniority: z.array(z.enum(SENIORITIES as [string, ...string[]])).optional(),
      contracts: z.array(z.enum(["b2b", "uop", "uz", "other"])).optional(),
      min_monthly_pln: z.number().nullable().optional().describe("Expected minimum per month in PLN; offers clearly below are skipped by the scan."),
      exclude_keywords: z.array(z.string()).optional(),
      exclude_companies: z.array(z.string()).optional(),
      sources: z.record(z.enum(SOURCES), z.boolean()).optional().describe("Turn portals on/off."),
      skills: z.array(z.string()).optional(),
      about: z.string().optional(),
      pay: z
        .object({
          form: z.enum(["ryczalt", "liniowy", "skala"]).optional(),
          ryczalt_rate: z.number().optional().describe("12 for programming, 8.5 for some IT services."),
          zus: z.enum(["full", "preferential", "start"]).optional(),
          sickness: z.boolean().optional(),
          costs_monthly: z.number().optional(),
          unpaid_days: z.number().optional().describe("Days a year without pay on B2B (holidays, sick days)."),
          commuting: z.boolean().optional().describe("UoP: commuting from another town (higher employee costs)."),
        })
        .optional()
        .describe("How the user would settle B2B – used for the 'na rękę' estimates."),
    },
  },
  tool(async (a: {
    keywords?: string[];
    locations?: string[];
    mode_locations?: { hybrid?: string[]; office?: string[] };
    work_modes?: Profile["workModes"];
    seniority?: string[];
    contracts?: Profile["contracts"];
    min_monthly_pln?: number | null;
    exclude_keywords?: string[];
    exclude_companies?: string[];
    sources?: Partial<Profile["sources"]>;
    skills?: string[];
    about?: string;
    pay?: { form?: B2bSettings["form"]; ryczalt_rate?: number; zus?: B2bSettings["zus"]; sickness?: boolean; costs_monthly?: number; unpaid_days?: number; commuting?: boolean };
  }) => {
    const p = await updateProfile((p) => {
      if (a.keywords) p.keywords = a.keywords;
      if (a.locations) p.locations = a.locations;
      if (a.mode_locations) p.modeLocations = { ...p.modeLocations, ...a.mode_locations };
      if (a.work_modes) p.workModes = a.work_modes;
      if (a.seniority) p.seniority = a.seniority as Profile["seniority"];
      if (a.contracts) p.contracts = a.contracts;
      if (a.min_monthly_pln !== undefined) p.minMonthlyPln = a.min_monthly_pln ?? undefined;
      if (a.exclude_keywords) p.excludeKeywords = a.exclude_keywords;
      if (a.exclude_companies) p.excludeCompanies = a.exclude_companies;
      if (a.sources) p.sources = { ...p.sources, ...a.sources };
      if (a.skills) p.skills = a.skills;
      if (a.about !== undefined) p.about = a.about;
      if (a.pay) {
        const q = a.pay;
        p.pay = {
          ...p.pay,
          ...(q.form && { form: q.form }),
          ...(q.ryczalt_rate != null && { ryczaltRate: q.ryczalt_rate }),
          ...(q.zus && { zus: q.zus }),
          ...(q.sickness != null && { sickness: q.sickness }),
          ...(q.costs_monthly != null && { costsMonthly: q.costs_monthly }),
          ...(q.unpaid_days != null && { unpaidDays: q.unpaid_days }),
          ...(q.commuting != null && { commuting: q.commuting }),
        };
      }
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
    description: "Searches Just Join IT, No Fluff Jobs and Bulldogjob (and LinkedIn's public search, Remotive and Himalayas if enabled) for the profile's keywords and adds offers published since the last scan (default) to the 'new' column, merging duplicates across portals. Takes up to a minute or two.",
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
  tool(async ({ job_id }: { job_id: string }) => {
    const job = await jobWithDescription(job_id);
    return jobDetails(job, companyResearch(readDb().companies, job.company));
  }),
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
  "save_company_research",
  {
    title: "Save company research",
    description:
      "Saves what you found out about an employer (follow the company research rules in the server instructions). Replaces earlier research of that company; the board shows it on every offer from it.",
    inputSchema: {
      name: z.string().describe("Company name as on the offer."),
      summary: z.string().describe("2–4 sentences in Polish: what they do, for whom, how it looks as an employer."),
      kind: z.string().optional().describe('e.g. "produkt", "software house", "body leasing / outsourcing", "agencja rekrutacyjna".'),
      industry: z.string().optional(),
      size: z.string().optional().describe('e.g. "ok. 800 osób w Polsce".'),
      website: z.string().optional(),
      ratings: z
        .array(
          z.object({
            site: z.string(),
            score: z.number(),
            out_of: z.number().describe("Top of the scale, e.g. 5."),
            reviews: z.number().int().optional(),
            url: z.string().optional(),
          }),
        )
        .optional(),
      pros: z.array(z.string()).optional(),
      cons: z.array(z.string()).optional(),
      flags: z.array(z.string()).optional(),
      sources: z.array(z.object({ title: z.string(), url: z.string() })).optional(),
    },
  },
  tool(async (a: {
    name: string;
    summary: string;
    kind?: string;
    industry?: string;
    size?: string;
    website?: string;
    ratings?: { site: string; score: number; out_of: number; reviews?: number; url?: string }[];
    pros?: string[];
    cons?: string[];
    flags?: string[];
    sources?: { title: string; url: string }[];
  }) => {
    const c = await saveCompany({
      name: a.name,
      summary: a.summary,
      kind: a.kind,
      industry: a.industry,
      size: a.size,
      website: a.website,
      ratings: (a.ratings ?? []).map((r) => ({ site: r.site, score: r.score, outOf: r.out_of, reviews: r.reviews, url: r.url })),
      pros: a.pros ?? [],
      cons: a.cons ?? [],
      flags: a.flags ?? [],
      sources: a.sources ?? [],
    });
    return `Zapisano research firmy.\n${companyText(c)}`;
  }),
);

server.registerTool(
  "log_events",
  {
    title: "Log application events",
    description:
      "Records what happened with applications – mostly e-mails from employers found in Gmail – and moves the cards accordingly (follow the Mail rules in the server instructions). Pass checked_until after going through the mailbox.",
    inputSchema: {
      events: z
        .array(
          z.object({
            job_id: z.string(),
            kind: z.enum(["sent", "follow_up", "reply", "interview_invite", "task", "rejection", "offer", "note"]).describe("follow_up = the user sent a reminder."),
            text: z.string().describe("One Polish sentence with the substance."),
            at: z.string().optional().describe("When it happened (the e-mail's date), ISO."),
            date: z.string().optional().describe("Interview date / task deadline, YYYY-MM-DD."),
            from: z.string().optional(),
            subject: z.string().optional(),
          }),
        )
        .describe("May be empty when nothing new was found."),
      checked_until: z.string().optional().describe("ISO time up to which the mailbox was checked (usually now)."),
    },
  },
  tool(async ({ events, checked_until }: { events: Parameters<typeof logEvents>[0]; checked_until?: string }) => {
    const jobs = await logEvents(events, checked_until);
    const head = checked_until ? `Skrzynka sprawdzona do ${checked_until.slice(0, 16).replace("T", " ")}.` : "";
    if (!jobs.length) return `${head} Brak nowych zdarzeń.`.trim();
    return `${head}\nZapisano:\n${jobs.map((j) => `- ${oneLine(j)} → ${STATUS_LABEL[j.status]}${j.nextStep ? ` · ${j.nextStep.text}${j.nextStep.date ? ` (${j.nextStep.date})` : ""}` : ""}`).join("\n")}`.trim();
  }),
);

server.registerTool(
  "save_document",
  {
    title: "Save tailored CV / cover letter / interview prep",
    description:
      "Saves a CV, cover letter or interview preparation (kind prep) for one offer, as Markdown (follow the rules in the server instructions). Replaces the previous version; the board offers PDF and DOCX downloads.",
    inputSchema: {
      job_id: z.string(),
      kind: z.enum(DOC_KINDS),
      markdown: z.string().min(1),
      language: z.enum(["pl", "en"]).optional(),
    },
  },
  tool(async ({ job_id, kind, markdown, language }: { job_id: string; kind: (typeof DOC_KINDS)[number]; markdown: string; language?: "pl" | "en" }) => {
    const job = await saveDocument(job_id, kind, markdown, language);
    return `Zapisano ${DOC_LABEL[kind]} dla „${job.title} @ ${job.company}”. Podgląd i pobieranie: http://127.0.0.1:3100/?job=${job.id}`;
  }),
);

server.registerTool(
  "get_document",
  {
    title: "Get tailored document",
    description: "The current Markdown of a tailored CV or cover letter (the user may have edited it on the board) – read it before revising.",
    inputSchema: { job_id: z.string(), kind: z.enum(DOC_KINDS) },
  },
  tool(async ({ job_id, kind }: { job_id: string; kind: (typeof DOC_KINDS)[number] }) => {
    const job = readDb().jobs[job_id];
    if (!job) throw new Error(`Nie ma oferty o id "${job_id}".`);
    const doc = job.documents?.[kind];
    return doc ? `${DOC_LABEL[kind]} (zmieniony ${doc.updatedAt.slice(0, 16).replace("T", " ")}):\n\n${doc.markdown}` : `Brak dokumentu ${DOC_LABEL[kind]} dla tej oferty.`;
  }),
);

server.registerTool(
  "compare_pay",
  {
    title: "Compare pay (UoP vs B2B)",
    description:
      "What is left per month ('na rękę', 2026 rules) from a UoP gross salary and/or a B2B invoice, for every B2B tax form with the user's settings, plus the invoice equal to the UoP salary. Use it for salary questions and negotiations; mention it is an estimate without reliefs.",
    inputSchema: {
      uop_gross: z.number().optional().describe("Monthly gross on an employment contract."),
      b2b_invoice: z.number().optional().describe("Monthly invoice net of VAT (hourly rate × 168)."),
    },
  },
  tool(async ({ uop_gross, b2b_invoice }: { uop_gross?: number; b2b_invoice?: number }) => {
    const profile = readProfile();
    const s = paySettings(profile.pay);
    const zl = (v: number) => `${Math.round(v).toLocaleString("pl-PL")} zł`;
    const lines: string[] = [`Ustawienia B2B: ${payText(s)}`];
    if (uop_gross) {
      const u = uopNet(uop_gross, { commuting: profile.pay?.commuting });
      lines.push(`UoP ${zl(uop_gross)} brutto → ${zl(u.net)} na rękę (${u.parts.map((x) => `${x.label} ${zl(x.amount)}`).join(", ")})`);
      lines.push(`Równoważna faktura B2B (${TAX_FORM_LABEL[s.form]}): ${zl(b2bEquivalent(uop_gross, s))} netto / mies.`);
    }
    if (b2b_invoice) {
      for (const form of ["ryczalt", "liniowy", "skala"] as const) {
        const r = b2bNet(b2b_invoice, { ...s, form });
        lines.push(`B2B ${zl(b2b_invoice)} · ${TAX_FORM_LABEL[form]}${form === "ryczalt" ? ` ${s.ryczaltRate}%` : ""} → ${zl(r.net)} na rękę (${r.parts.filter((x) => x.amount > 0).map((x) => `${x.label} ${zl(x.amount)}`).join(", ")})`);
      }
    }
    if (!uop_gross && !b2b_invoice) throw new Error("Podaj uop_gross albo b2b_invoice.");
    lines.push("Szacunek wg przepisów 2026, bez ulg (IP Box, dla młodych), PPK i wspólnego rozliczenia.");
    return lines.join("\n");
  }),
);

server.registerTool(
  "get_market_insights",
  {
    title: "Market insights",
    description:
      "What the collected offers say: salary medians and quartiles by level (B2B net, UoP gross, monthly PLN), the most requested skills and whether the CV shows them, the gaps Claude's ratings name most often, and results per source.",
    inputSchema: { days: z.number().int().min(0).optional().describe("Window in days (default 90; 0 = everything).") },
  },
  tool(async ({ days }: { days?: number }) => {
    const profile = readProfile();
    const ins = computeInsights(Object.values(readDb().jobs), profile, { days: days ?? 90 });
    if (!ins.total) return "Brak ofert w tym okresie.";
    const k = (v: number) => `${Math.round(v / 100) / 10}k`;
    const lvl = (s: string) => (s === "all" ? "wszystkie" : SENIORITY_LABEL[s as keyof typeof SENIORITY_LABEL]);
    return [
      `Okno: ${ins.days ? `${ins.days} dni` : "wszystko"} · ofert ${ins.total} (z widełkami ${ins.withSalary}, ocenionych ${ins.rated}${ins.avgFit != null ? `, śr. ocena ${ins.avgFit}` : ""})`,
      profile.minMonthlyPln ? `Oczekiwanie użytkownika: min ${k(profile.minMonthlyPln)} / mies.` : "",
      "\nWidełki (PLN / mies., środek przedziału; mediana [25.–75. percentyl], liczba ofert):",
      ...ins.salary.map((b) => `- ${b.contract === "b2b" ? "B2B netto" : "UoP brutto"} · ${lvl(b.seniority)}: ${k(b.median)} [${k(b.p25)}–${k(b.p75)}], n=${b.n}`),
      "\nNajczęściej wymagane (udział ofert; ✓ = jest w CV/profilu):",
      ...ins.skills.slice(0, 20).map((s) => `- ${s.inCv ? "✓" : "✗"} ${s.name}: ${Math.round(s.share * 100)}% (${s.count})`),
      ins.gaps.length ? `\nNajczęstsze braki w ocenach: ${ins.gaps.map((g) => `${g.text} (${g.count}×)`).join(", ")}` : "",
      "\nŹródła (oferty / ocenione / śr. ocena / 65+ / wybrane / wysłane / rozmowy):",
      ...ins.sources.map((s) => `- ${SOURCE_LABEL[s.source]}: ${s.offers} / ${s.rated} / ${s.avgFit ?? "–"} / ${s.good} / ${s.picked} / ${s.applied} / ${s.interviews}`),
      funnelText(),
      learningText(readDb().learningPlan),
      "\nTylko oferty zebrane przez JobDeck (frazy i filtry użytkownika) – nie cały rynek. Wykresy: http://127.0.0.1:3100/insights",
    ]
      .filter(Boolean)
      .join("\n");
  }),
);

server.registerTool(
  "refilter_inbox",
  {
    title: "Re-filter the inbox",
    description:
      "Checks the new offers against the current filters (search phrases in the title or skill tags, contract, level, work mode and cities, salary) – e.g. after the user changed the profile. Without apply it lists what does not fit; with apply it removes those offers (only untouched scan results: no star, notes, history or documents). Ask the user before apply.",
    inputSchema: { apply: z.boolean().optional().describe("Remove them (default: only list).") },
  },
  tool(async ({ apply }: { apply?: boolean }) => {
    const found = await refilterInbox(!!apply);
    if (!found.length) return "Wszystkie nowe oferty pasują do obecnych filtrów.";
    return [
      `${apply ? "Usunięto" : "Nie pasuje do filtrów"}: ${found.length} nowych ofert.`,
      ...found.slice(0, 60).map(({ job, reason }) => `- ${job.title} @ ${job.company}: ${reason}`),
      found.length > 60 ? `…i ${found.length - 60} więcej.` : "",
      apply ? "" : "Usunąć je? (refilter_inbox apply: true – po zgodzie użytkownika)",
    ]
      .filter(Boolean)
      .join("\n");
  }),
);

server.registerTool(
  "save_learning_plan",
  {
    title: "Save learning plan",
    description:
      "Saves the learning plan shown on the Market page: 3–5 skills from the recurring gaps, each with why, a small project that proves it in the CV, effort and resources (follow the learning plan rules in the server instructions). Replaces the previous plan; items the user ticked off stay ticked off.",
    inputSchema: {
      items: z
        .array(
          z.object({
            skill: z.string(),
            why: z.string().describe("Polish, with numbers from get_market_insights."),
            project: z.string().describe("Polish: what to build and which part shows the skill."),
            effort: z.string().optional().describe('e.g. "weekend", "2–3 tygodnie".'),
            resources: z.array(z.object({ title: z.string(), url: z.string().url() })).optional(),
          }),
        )
        .min(1)
        .max(8),
      based_on: z.string().optional().describe('e.g. "38 ocenionych ofert z 90 dni".'),
    },
  },
  tool(async ({ items, based_on }: { items: { skill: string; why: string; project: string; effort?: string; resources?: { title: string; url: string }[] }[]; based_on?: string }) => {
    const plan = await saveLearningPlan(
      items.map((i) => ({ ...i, resources: i.resources ?? [] })),
      based_on,
    );
    return `Zapisano plan nauki (${plan.items.length}).${learningText(plan)}\nNa tablicy: http://127.0.0.1:3100/insights`;
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
      offered: z
        .object({ monthly: z.number().positive().describe("Monthly PLN: B2B net (hourly × 168) or UoP gross."), contract: z.enum(["b2b", "uop"]) })
        .nullable()
        .optional()
        .describe("What the company proposed; null clears it. Used by the negotiation section."),
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
    offered?: Job["offered"] | null;
  }) => {
    const jobs = await patchJobs(a.job_ids, {
      status: a.status,
      closedReason: a.closed_reason,
      notes: a.notes,
      starred: a.starred,
      nextStep: a.next_step,
      appliedAt: a.applied_at,
      offered: a.offered,
    });
    return `Zaktualizowano:\n${jobs.map((j) => `- ${oneLine(j)} → ${STATUS_LABEL[j.status]}`).join("\n")}`;
  }),
);

await server.connect(new StdioServerTransport());
