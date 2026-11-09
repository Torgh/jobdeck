import { describe, expect, it } from "vitest";
import { computeInsights, gapKey, quantile } from "./insights";
import type { Job } from "./types";

const NOW = Date.parse("2026-11-10T12:00:00Z");
let n = 0;
const job = (over: Partial<Job>): Job => ({
  id: `j${n++}`,
  key: `k${n}`,
  title: "Dev",
  company: "X",
  url: "u",
  source: "justjoin",
  links: [{ source: "justjoin", url: "u" }],
  salaries: [],
  skills: [],
  foundAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  status: "new",
  statusChangedAt: "2026-11-01T00:00:00Z",
  ...over,
});
const b2b = (min: number, max: number) => ({ currency: "PLN", period: "month" as const, contract: "b2b" as const, monthlyPln: { min, max } });

describe("quantile", () => {
  it("interpolates", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10], 0.25)).toBe(10);
  });
});

describe("gapKey", () => {
  it("normalises Claude's gap phrases", () => {
    expect(gapKey("AWS – nie widać w CV")).toBe("aws");
    expect(gapKey("Brak Terraform (wymagane)")).toBe("terraform");
    expect(gapKey("aws")).toBe(gapKey("AWS"));
  });
});

describe("computeInsights", () => {
  const jobs = [
    job({ seniority: "senior", salaries: [b2b(20_000, 24_000)], skills: ["Kotlin", "AWS"], fit: { score: 80, verdict: "strong", summary: "", strengths: [], gaps: ["AWS – nie widać w CV"], ratedAt: "" } }),
    job({ seniority: "senior", salaries: [b2b(24_000, 28_000)], skills: ["kotlin", "Kafka"], fit: { score: 60, verdict: "partial", summary: "", strengths: [], gaps: ["aws"], ratedAt: "" }, status: "applied", appliedAt: "2026-11-02" }),
    job({ seniority: "senior", salaries: [b2b(28_000, 32_000)], skills: ["Kotlin"], links: [{ source: "nofluff", url: "v" }], status: "interview" }),
    job({ seniority: "mid", salaries: [{ currency: "PLN", period: "month", contract: "uop", gross: true, monthlyPln: { min: 12_000, max: 14_000 } }], skills: ["Java"] }),
    job({ foundAt: "2026-06-01T00:00:00Z", skills: ["Cobol"] }),
  ];
  const ins = computeInsights(jobs, { skills: ["Kotlin"], cv: { text: "Kafka" } }, { days: 90, now: NOW });

  it("counts offers in the window", () => {
    expect(ins.total).toBe(4);
    expect(ins.withSalary).toBe(4);
    expect(ins.rated).toBe(2);
    expect(ins.avgFit).toBe(70);
  });

  it("builds salary bands with at least three offers", () => {
    expect(ins.salary).toEqual([
      { contract: "b2b", seniority: "senior", n: 3, p25: 24_000, median: 26_000, p75: 28_000 },
      { contract: "b2b", seniority: "all", n: 3, p25: 24_000, median: 26_000, p75: 28_000 },
    ]);
  });

  it("ranks skills and marks the ones in the CV", () => {
    expect(ins.skills.slice(0, 2)).toEqual([
      { name: "Kotlin", count: 3, share: 0.75, inCv: true },
      expect.objectContaining({ count: 1 }),
    ]);
    expect(ins.skills.find((s) => s.name === "AWS")?.inCv).toBe(false);
    expect(ins.skills.find((s) => s.name === "Kafka")?.inCv).toBe(true);
    expect(ins.skills.some((s) => s.name === "Cobol")).toBe(false);
  });

  it("aggregates recurring gaps and per-source results", () => {
    expect(ins.gaps).toEqual([{ text: "AWS", count: 2 }]);
    const jj = ins.sources.find((s) => s.source === "justjoin")!;
    expect(jj).toMatchObject({ offers: 3, rated: 2, avgFit: 70, good: 1, applied: 1 });
    expect(ins.sources.find((s) => s.source === "nofluff")).toMatchObject({ offers: 1, interviews: 1, applied: 1 });
  });
});
