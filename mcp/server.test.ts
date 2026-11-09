import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Starts the real MCP server (bun) on an empty data folder and drives it like Claude would. */
const home = fs.mkdtempSync(path.join(os.tmpdir(), "jobdeck-mcp-"));
const client = new Client({ name: "test", version: "1" });

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = res.content.map((c) => c.text).join("\n");
  if (res.isError) throw new Error(text);
  return text;
}

beforeAll(async () => {
  await client.connect(
    new StdioClientTransport({
      command: process.platform === "win32" ? "bun.exe" : "bun",
      args: [path.join(__dirname, "server.ts")],
      env: { ...(process.env as Record<string, string>), JOBDECK_HOME: home },
    }),
  );
}, 30_000);

afterAll(async () => {
  await client.close();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("JobDeck MCP server", () => {
  it("lists its tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["add_jobs", "compare_pay", "get_document", "get_job", "get_overview", "get_profile", "import_cv", "list_jobs", "log_events", "rate_jobs", "save_company_research", "save_document", "scan_portals", "update_job", "update_profile"].sort(),
    );
  });

  it("walks through profile → CV → add → rate → apply", async () => {
    expect(await call("get_overview")).toMatch(/brak CV/);
    await call("update_profile", { keywords: ["java"], skills: ["Java", "Spring Boot"], seniority: ["mid", "senior"] });

    const cvPath = path.join(home, "cv-source.md");
    fs.writeFileSync(cvPath, `# Jan Kowalski\nSenior Java Developer, 6 lat doświadczenia.\n${"Java, Spring Boot, PostgreSQL, Kafka, Docker. ".repeat(10)}`);
    expect(await call("import_cv", { path: cvPath })).toMatch(/CV wgrane/);
    expect(await call("get_profile")).toMatch(/Treść CV[\s\S]*Jan Kowalski/);

    const added = await call("add_jobs", {
      jobs: [
        {
          title: "Senior Java Developer",
          company: "Acme",
          url: "https://www.linkedin.com/jobs/view/senior-java-developer-at-acme-4487147398?trk=x",
          source: "linkedin",
          location: "Kraków",
          work_mode: "hybrid",
          salary_text: "25 000 – 30 000 PLN brutto / mies.",
          skills: ["Java", "Kafka", "AWS"],
          description: "Szukamy seniora Java z Kafka i AWS.",
        },
        { title: "Junior PHP Developer", company: "Beta", url: "https://example.com/2", source: "pracuj" },
      ],
    });
    expect(added).toMatch(/Dodano 1, scalono z istniejącymi 0, pominięto 1/);
    const id = added.match(/\[([\w-]+)\]/)![1];

    // The LinkedIn link is stored in its canonical form, and a second alert with it is merged.
    expect(await call("get_job", { job_id: id })).toMatch(/https:\/\/www\.linkedin\.com\/jobs\/view\/4487147398\n/);
    expect(
      await call("add_jobs", { jobs: [{ title: "Senior Java Developer", company: "ACME", url: "https://www.linkedin.com/jobs/view/4487147398", source: "linkedin" }] }),
    ).toMatch(/scalono z istniejącymi 1/);

    await call("rate_jobs", {
      ratings: [{ job_id: id, score: 78, summary: "Mocny Java/Spring, brak AWS.", strengths: ["6 lat Javy", "Kafka"], gaps: ["AWS – nie widać w CV"] }],
    });
    expect(await call("list_jobs", { min_score: 70 })).toMatch(/fit 78/);

    await call("update_job", { job_ids: [id], status: "applied", next_step: { text: "Follow-up", date: "2026-11-20" } });
    const job = await call("get_job", { job_id: id });
    expect(job).toMatch(/status: Wysłane/);
    expect(job).toMatch(/Następny krok: Follow-up \(2026-11-20\)/);
    expect(job).toMatch(/Ocena: 78\/100 – Dobre dopasowanie/);

    // An active offer whose employer is not researched yet shows up in the overview…
    expect(await call("get_overview")).toMatch(/Sprawdź firmę Acme/);
    await call("save_company_research", {
      name: "ACME Sp. z o.o.",
      summary: "Produkt SaaS dla logistyki.",
      kind: "produkt",
      ratings: [{ site: "GoWork.pl", score: 3.9, out_of: 5, reviews: 120, url: "https://gowork.pl/acme" }],
      pros: ["stabilne zatrudnienie"],
      cons: ["wolne podwyżki"],
      flags: ["zapytać o on-call"],
      sources: [{ title: "GoWork", url: "https://gowork.pl/acme" }],
    });
    // …and once researched, every offer from that company carries it.
    expect(await call("get_job", { job_id: id })).toMatch(/## Firma: ACME Sp\. z o\.o\.[\s\S]*GoWork\.pl 3\.9\/5 \(120 opinii\)/);
    expect(await call("get_overview")).not.toMatch(/Sprawdź firmę/);
  });

  it("tracks replies from the mailbox and moves the card", async () => {
    const added = await call("add_jobs", {
      jobs: [{ title: "Senior Kotlin Developer", company: "Gamma", url: "https://example.com/gamma", source: "other", work_mode: "remote" }],
    });
    const id = added.match(/\[([\w-]+)\]/)![1];
    await call("update_job", { job_ids: [id], status: "applied" });
    expect(await call("get_overview")).toMatch(/Mail – aplikacje do obserwowania \(sprawdzono skrzynkę: nigdy\)[\s\S]*Gamma/);

    const res = await call("log_events", {
      events: [
        { job_id: id, kind: "reply", text: "Rekruterka dziękuje za CV i odezwie się w tym tygodniu.", at: "2026-11-10T09:00:00Z", subject: "Re: Senior Kotlin" },
        { job_id: id, kind: "interview_invite", text: "Rozmowa techniczna online", at: "2026-11-11T10:00:00Z", date: "2026-11-14", subject: "Zaproszenie" },
      ],
      checked_until: "2026-11-11T12:00:00Z",
    });
    expect(res).toMatch(/Skrzynka sprawdzona do 2026-11-11 12:00/);
    expect(res).toMatch(/→ Rozmowy · Rozmowa techniczna online \(2026-11-14\)/);
    const job = await call("get_job", { job_id: id });
    expect(job).toMatch(/2026-11-10 Odpowiedź: Rekruterka dziękuje/);
    expect(job).toMatch(/Zaproszenie na rozmowę: Rozmowa techniczna online \[Zaproszenie\]/);
    expect(job).toMatch(/status: Rozmowy/);
    // The invitation itself explains the move: no extra "Zmiana etapu" entry for it.
    expect(job).not.toMatch(/Zmiana etapu: Wysłane → Rozmowy/);
    expect(job).toMatch(/Wysłano aplikację: Nowe → Wysłane/);
    expect(await call("get_overview")).toMatch(/sprawdzono skrzynkę: 2026-11-11 12:00/);

    // The same e-mail logged twice is recorded once; a rejection closes the card.
    await call("log_events", { events: [{ job_id: id, kind: "reply", text: "x", at: "2026-11-10T09:00:00Z", subject: "Re: Senior Kotlin" }] });
    expect((await call("get_job", { job_id: id })).match(/Odpowiedź:/g)).toHaveLength(1);
    await call("log_events", { events: [{ job_id: id, kind: "rejection", text: "Wybrali innego kandydata." }] });
    expect(await call("get_job", { job_id: id })).toMatch(/status: Zamknięte \(Odrzucili\)/);
  });

  it("stores tailored documents", async () => {
    const added = await call("add_jobs", {
      jobs: [{ title: "Backend Engineer", company: "Delta", url: "https://example.com/delta", source: "other", work_mode: "remote" }],
    });
    const id = added.match(/\[([\w-]+)\]/)![1];
    expect(await call("get_document", { job_id: id, kind: "cv" })).toMatch(/Brak dokumentu CV/);
    expect(await call("save_document", { job_id: id, kind: "cv", markdown: "# Jan Kowalski\n\n## Doświadczenie\n- Allegro" })).toMatch(/\?job=/);
    expect(await call("get_document", { job_id: id, kind: "cv" })).toMatch(/# Jan Kowalski/);
    expect(await call("get_job", { job_id: id })).toMatch(/Dokumenty: CV \(/);
  });

  it("compares UoP and B2B pay with the user's settings", async () => {
    await call("update_profile", { pay: { form: "liniowy", costs_monthly: 300 } });
    const res = await call("compare_pay", { uop_gross: 10000, b2b_invoice: 20000 });
    expect(res).toMatch(/UoP 10\s000 zł brutto → 7\s?147 zł na rękę/);
    expect(res).toMatch(/Równoważna faktura B2B \(Liniowy 19%\)/);
    expect(res).toMatch(/Ryczałt 12% → 14\s?929 zł na rękę/);
    expect(await call("get_profile", { include_cv: false })).toMatch(/Rozliczenie B2B .*Liniowy 19%/);
  });

  it("reports errors as tool errors", async () => {
    await expect(call("get_job", { job_id: "nope" })).rejects.toThrow(/Nie ma oferty/);
  });
});
