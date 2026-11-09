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
      ["add_jobs", "get_job", "get_overview", "get_profile", "import_cv", "list_jobs", "rate_jobs", "scan_portals", "update_job", "update_profile"].sort(),
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
  });

  it("reports errors as tool errors", async () => {
    await expect(call("get_job", { job_id: "nope" })).rejects.toThrow(/Nie ma oferty/);
  });
});
