import { companyKey } from "./jobs";
import type { CompanyInfo, Db, Fit, Job, LearningPlan, Salary } from "./types";

/**
 * Test data for trying the board out: fictional companies, every record marked `demo: true`, so it can be
 * removed without touching the user's real offers, profile or CV. Dates are relative to `now`.
 */

const DAY = 86_400_000;

function build(now: number): { jobs: Job[]; companies: Record<string, CompanyInfo>; plan: LearningPlan } {
  const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();
  const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);
  const b2b = (min: number, max: number): Salary => ({ min, max, currency: "PLN", period: "month", contract: "b2b", monthlyPln: { min, max } });
  const uop = (min: number, max: number): Salary => ({ min, max, currency: "PLN", period: "month", contract: "uop", gross: true, monthlyPln: { min, max } });
  const fit = (score: number, summary: string, strengths: string[], gaps: string[]): Fit => ({
    score,
    summary,
    strengths,
    gaps,
    ratedAt: iso(1),
    verdict: score >= 80 ? "strong" : score >= 65 ? "good" : score >= 45 ? "partial" : "weak",
  });

  let n = 0;
  const job = (o: Partial<Job> & Pick<Job, "title" | "company">): Job => {
    const id = `demo-${++n}`;
    return {
      id,
      key: `demo|${id}`,
      url: "https://example.com/oferta-testowa",
      source: "justjoin",
      links: [{ source: "justjoin", url: "https://example.com/oferta-testowa" }],
      salaries: [],
      skills: [],
      foundAt: iso(3),
      updatedAt: iso(1),
      status: "new",
      statusChangedAt: iso(3),
      publishedAt: iso(3),
      description: `To jest oferta testowa (firma fikcyjna).\n\nStanowisko: ${o.title}\nWymagania: ${(o.skills ?? []).join(", ") || "—"}.\n\nUsuń dane testowe w Ustawieniach, gdy przestaną być potrzebne.`,
      descriptionFetchedAt: iso(3),
      demo: true,
      ...o,
    };
  };

  const jobs: Job[] = [
    job({
      title: "Senior Java Developer", company: "Northwind (test)", workMode: "remote", seniority: "senior", salaries: [b2b(24000, 28000)],
      skills: ["Java", "Spring Boot", "Kafka", "Kubernetes"],
      fit: fit(86, "6 lat Javy i Springa pokrywa core, Kafka z obecnego projektu. Brakuje Kubernetesa.", ["Java + Spring 6 lat", "Kafka w produkcji"], ["Kubernetes – nie widać w CV"]),
    }),
    job({
      title: "Backend Engineer (Kotlin)", company: "Fabrikam (test)", workMode: "hybrid", location: "Wrocław", seniority: "mid", salaries: [uop(21000, 25000)],
      skills: ["Kotlin", "PostgreSQL", "AWS"],
      fit: fit(78, "Produkt, mały zespół. Kotlin tylko w projektach pobocznych.", ["PostgreSQL", "REST API"], ["Kotlin komercyjnie", "AWS"]),
    }),
    job({
      title: "Java Developer – payments", company: "Contoso (test)", workMode: "remote", seniority: "mid", salaries: [b2b(20000, 23000)],
      skills: ["Java", "Microservices", "SQL"], firstPublishedAt: iso(95), refreshCount: 3,
      fit: fit(71, "Domena płatności pasuje; oferta wystawiana od ponad 90 dni.", ["Java", "SQL"], ["Doświadczenie w płatnościach"]),
    }),
    job({ title: "Fullstack Developer", company: "Litware (test)", workMode: "remote", salaries: [b2b(16000, 19000)], skills: ["Java", "React", "TypeScript"], stackMatch: 67 }),
    job({
      title: "Platform Engineer", company: "Tailspin (test)", workMode: "remote", seniority: "senior", status: "interesting", statusChangedAt: iso(3),
      salaries: [b2b(22000, 26000)], skills: ["Go", "Kubernetes"], expiresAt: iso(-2),
      fit: fit(74, "Silne podstawy backendu, Go do nadrobienia.", ["Linux", "CI/CD"], ["Go"]),
    }),
    job({
      title: "Senior Backend Developer", company: "Wingtip (test)", workMode: "hybrid", location: "Wrocław", seniority: "senior", status: "applying", statusChangedAt: iso(1),
      salaries: [uop(24000, 28000)], skills: ["Java", "Spring"],
      fit: fit(67, "Dobry stack, ale firma szuka lidera zespołu.", ["Java", "Spring"], ["Zarządzanie zespołem"]),
      documents: { cv: { markdown: "# Imię Nazwisko\n\nCV testowe – tu będzie CV dopasowane do oferty.\n\n## Doświadczenie\n- Przykładowy punkt", updatedAt: iso(1), language: "pl" } },
    }),
    job({
      title: "Java Developer", company: "Adatum (test)", workMode: "remote", seniority: "mid", status: "applied", statusChangedAt: iso(9), appliedAt: day(9),
      salaries: [b2b(18000, 21000)], skills: ["Java", "Spring Boot", "SQL"],
      fit: fit(69, "Solidne dopasowanie, bez wyróżników.", ["Java", "SQL"], ["Testy kontraktowe"]),
      events: [{ at: iso(9), kind: "sent", text: "Ciekawe → Wysłane", by: "app" }],
    }),
    job({
      title: "Software Engineer", company: "Proseware (test)", workMode: "hybrid", location: "Wrocław", status: "applied", statusChangedAt: iso(2), appliedAt: day(2),
      salaries: [uop(17000, 20000)], skills: ["Java", "Angular"],
      fit: fit(64, "Częściowe dopasowanie – dużo frontendu.", ["Java"], ["Angular"]),
      events: [{ at: iso(2), kind: "sent", text: "Ciekawe → Wysłane", by: "app" }],
    }),
    job({
      title: "Senior Java Engineer", company: "Woodgrove (test)", workMode: "remote", seniority: "senior", status: "interview", statusChangedAt: iso(3), appliedAt: day(8),
      salaries: [b2b(25000, 29000)], skills: ["Java", "Kafka", "AWS"], nextStep: { text: "Rozmowa techniczna", date: day(-1) },
      fit: fit(82, "Bardzo dobre dopasowanie, Kafka i mikroserwisy.", ["Kafka", "Mikroserwisy"], ["AWS – nie widać w CV"]),
      events: [
        { at: iso(8), kind: "sent", text: "Wysłano aplikację", by: "app" },
        { at: iso(5), kind: "reply", text: "Rekruterka prosi o dostępne terminy rozmowy.", by: "claude", from: "rekrutacja@woodgrove.example" },
        { at: iso(3), kind: "interview_invite", text: "Rozmowa techniczna (1 h, online).", by: "claude", from: "rekrutacja@woodgrove.example" },
      ],
    }),
  ];

  const companies: Record<string, CompanyInfo> = {
    [companyKey("Woodgrove (test)")]: {
      name: "Woodgrove (test)",
      summary: "Firma fikcyjna – przykład tego, jak wygląda research firmy od Claude.",
      kind: "produkt",
      industry: "fintech",
      ratings: [],
      pros: ["Przykładowy plus"],
      cons: ["Przykładowy minus"],
      flags: ["Przykładowa rzecz do sprawdzenia na rozmowie"],
      sources: [],
      researchedAt: iso(2),
      demo: true,
    },
  };

  const plan: LearningPlan = {
    createdAt: iso(5),
    basedOn: "dane testowe",
    demo: true,
    items: [
      { skill: "Kubernetes", why: "Przykład: brakuje w 7 z 24 ocenionych ofert.", project: "Wdrożenie własnego serwisu na k3s z Helm chartem.", effort: "weekend", resources: [], done: true },
      { skill: "Kafka Streams", why: "Przykład: w 5 ofertach z oceną 65+.", project: "Kolejka zamówień z retry i DLQ.", effort: "weekend", resources: [] },
      { skill: "AWS", why: "Przykład: w 6 z 24 ofert.", project: "Lambda + SQS do przetwarzania plików.", effort: "2 tygodnie", resources: [] },
    ],
  };

  return { jobs, companies, plan };
}

/** Puts the test data on the board (again, fresh dates); the user's own records stay as they are. */
export function addDemo(db: Db, now = Date.now()): number {
  removeDemo(db);
  const { jobs, companies, plan } = build(now);
  for (const j of jobs) db.jobs[j.id] = j;
  for (const [k, c] of Object.entries(companies)) if (!db.companies?.[k]) db.companies = { ...db.companies, [k]: c };
  if (!db.learningPlan) db.learningPlan = plan;
  return jobs.length;
}

/** Removes everything the test data added, and nothing else. */
export function removeDemo(db: Db): number {
  const ids = Object.values(db.jobs).filter((j) => j.demo).map((j) => j.id);
  for (const id of ids) delete db.jobs[id];
  if (db.companies) for (const [k, c] of Object.entries(db.companies)) if (c.demo) delete db.companies[k];
  if (db.learningPlan?.demo) delete db.learningPlan;
  return ids.length;
}

export function demoCount(db: Pick<Db, "jobs">): number {
  return Object.values(db.jobs).filter((j) => j.demo).length;
}
