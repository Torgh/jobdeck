import { describe, expect, it } from "vitest";
import { computeFunnel, computeInsights, gapKey, negotiation, quantile, type SalaryBand } from "./insights";
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

describe("computeFunnel", () => {
  const ev = (kind: string, at: string, text = "") => ({ kind, at, text }) as NonNullable<Job["events"]>[number];
  const jobs = [
    job({ status: "interesting" }),
    job({ status: "closed", closedReason: "not_for_me" }),
    job({ status: "applied", appliedAt: "2026-10-01" }),
    job({ status: "applied", appliedAt: "2026-11-03", events: [ev("reply", "2026-11-05T10:00:00Z")] }),
    job({ status: "interview", appliedAt: "2026-11-02", events: [ev("interview_invite", "2026-11-06T10:00:00Z")] }),
    job({ status: "closed", closedReason: "rejected", appliedAt: "2026-10-20" }),
    job({ status: "offer", appliedAt: "2026-10-10", events: [ev("interview_invite", "2026-10-14T00:00:00Z"), ev("offer", "2026-10-30T00:00:00Z")] }),
  ];
  const f = computeFunnel(jobs, NOW);

  it("counts each stage", () => {
    expect(f.stages.map((s) => [s.key, s.count])).toEqual([
      ["picked", 6],
      ["applied", 5],
      ["responded", 4],
      ["interview", 2],
      ["offer", 1],
    ]);
    expect(f.responseRate).toBe(0.8);
    expect(f.interviewRate).toBe(0.4);
  });

  it("measures waiting and silence", () => {
    // first answers after 2, 4 and 4 days
    expect(f.medianDaysToAnswer).toBe(4);
    expect(f.noAnswer).toBe(1);
  });

  it("groups applications by week", () => {
    expect(f.weekly).toHaveLength(8);
    expect(f.weekly.at(-1)).toEqual({ week: "2026-11-09", applied: 0 });
    expect(f.weekly.find((w) => w.week === "2026-11-02")?.applied).toBe(2);
  });
});

describe("negotiation", () => {
  const bands: SalaryBand[] = [
    { contract: "b2b", seniority: "senior", n: 12, p25: 22000, median: 25000, p75: 28000 },
    { contract: "b2b", seniority: "all", n: 30, p25: 18000, median: 22000, p75: 26000 },
  ];

  it("asks for the top of the range when the proposal is below it", () => {
    const [n] = negotiation({ seniority: "senior", salaries: [b2b(20000, 27000)], offered: { monthly: 23000, contract: "b2b" } }, bands);
    expect(n).toMatchObject({ contract: "b2b", offered: 23000, ask: 27000, position: "p25_median" });
    expect(n.band?.seniority).toBe("senior");
    expect(n.reasons[0]).toContain("27k");
  });

  it("raises a low offer to the market median for the level, and to the user's minimum", () => {
    expect(negotiation({ seniority: "senior", salaries: [b2b(15000, 20000)] }, bands)[0]).toMatchObject({ ask: 25000, position: "below_p25" });
    expect(negotiation({ seniority: "senior", salaries: [b2b(15000, 20000)] }, bands, { minMonthly: 26200 })[0].ask).toBe(26500);
  });

  it("counters a proposal already at the top with a small margin, and falls back to all levels", () => {
    expect(negotiation({ seniority: "senior", salaries: [b2b(25000, 30000)], offered: { monthly: 30000, contract: "b2b" } }, bands)[0].ask).toBe(32500);
    expect(negotiation({ seniority: "junior", salaries: [] , offered: { monthly: 15000, contract: "b2b" } }, bands)[0]).toMatchObject({ ask: 22000 });
    expect(negotiation({ salaries: [] }, bands)).toEqual([]);
  });
});
