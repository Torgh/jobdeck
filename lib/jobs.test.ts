import { describe, expect, it } from "vitest";
import { filterReason, jobKey, seniorityFrom, stackMatch, staleness, todos, workModeFrom } from "./jobs";
import { DEFAULT_PROFILE, type Job, type Profile } from "./types";

const profile: Profile = { ...DEFAULT_PROFILE, locations: ["Kraków"], excludeKeywords: ["php"], minMonthlyPln: 20000 };

const job = (over: Partial<Job>): Job => ({
  id: "a",
  key: "k",
  title: "Dev",
  company: "X",
  url: "u",
  source: "justjoin",
  links: [],
  salaries: [],
  skills: [],
  foundAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  status: "new",
  statusChangedAt: "2026-11-01T00:00:00Z",
  ...over,
});

describe("jobKey", () => {
  it("merges the same offer from different portals", () => {
    expect(jobKey("Senior Java Developer (m/f/d)", "Allegro sp. z o.o.")).toBe(jobKey("Senior Java Developer", "ALLEGRO"));
    expect(jobKey("Senior Java Developer", "Allegro")).not.toBe(jobKey("Java Developer", "Allegro"));
  });
});

describe("parsing hints", () => {
  it("reads seniority and work mode", () => {
    expect(seniorityFrom("Starszy specjalista (senior)")).toBe("senior");
    expect(seniorityFrom("Specjalista (Mid / Regular)")).toBe("mid");
    expect(seniorityFrom("Tech Lead Java")).toBe("lead");
    expect(workModeFrom("Praca zdalna")).toBe("remote");
    expect(workModeFrom("Praca hybrydowa (3 dni)")).toBe("hybrid");
  });
});

describe("filterReason", () => {
  const base = { title: "Java Developer", company: "X", url: "u", source: "justjoin" as const };

  it("keeps matching offers and remote ones anywhere", () => {
    expect(filterReason({ ...base, location: "Kraków", workMode: "hybrid" }, profile)).toBeUndefined();
    expect(filterReason({ ...base, location: "Gdańsk", workMode: "remote" }, profile)).toBeUndefined();
  });

  it("limits hybrid and office to their own cities, never remote", () => {
    const p: Profile = { ...DEFAULT_PROFILE, workModes: ["remote", "hybrid"], modeLocations: { hybrid: ["Wrocław"], office: [] } };
    expect(filterReason({ ...base, location: "Wrocław", workMode: "hybrid" }, p)).toBeUndefined();
    expect(filterReason({ ...base, location: "Warszawa", workMode: "hybrid" }, p)).toMatch(/lokalizacja Warszawa \(hybrid\)/);
    expect(filterReason({ ...base, location: "Warszawa", workMode: "remote" }, p)).toBeUndefined();
    // Unknown mode: only the enabled on-site modes count (office is off).
    expect(filterReason({ ...base, location: "Warszawa" }, p)).toMatch(/lokalizacja/);
    expect(filterReason({ ...base, location: "Wrocław, Fabryczna" }, p)).toBeUndefined();
  });

  it("skips excluded words, other cities, other levels, low pay", () => {
    expect(filterReason({ ...base, title: "PHP Developer" }, profile)).toMatch(/php/);
    expect(filterReason({ ...base, location: "Gdańsk", workMode: "hybrid" }, profile)).toMatch(/lokalizacja/);
    expect(filterReason({ ...base, title: "Junior Java Developer" }, profile)).toMatch(/junior/);
    expect(filterReason({ ...base, workMode: "office" }, profile)).toMatch(/office/);
    expect(
      filterReason({ ...base, salaries: [{ currency: "PLN", period: "month", monthlyPln: { min: 9000, max: 12000 } }] }, profile),
    ).toMatch(/widełki/);
  });
});

describe("stackMatch", () => {
  it("counts skills found in the CV and profile", () => {
    const p = { skills: ["Kafka"], cv: { text: "5 lat Java, Spring Boot i PostgreSQL", fileName: "", uploadedAt: "", hash: "" } };
    expect(stackMatch(["Java", "Spring Boot", "Kafka", "AWS"], p)).toBe(75);
    expect(stackMatch([], p)).toBeUndefined();
    expect(stackMatch(["Java"], { skills: [] })).toBeUndefined();
  });
});

describe("todos", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");

  const researched = (at: string) => ({
    x: { name: "X", summary: "", ratings: [], pros: [], cons: [], flags: [], sources: [], researchedAt: at },
  });

  it("lists follow-ups, due steps and expiring offers", () => {
    const list = todos(
      [
        job({ id: "1", status: "applied", statusChangedAt: "2026-11-01T00:00:00Z" }),
        job({ id: "2", status: "interview", nextStep: { text: "Rozmowa", date: "2026-11-10" } }),
        job({ id: "3", status: "interesting", expiresAt: "2026-11-12T00:00:00Z" }),
        job({ id: "4", status: "applied", statusChangedAt: "2026-11-08T00:00:00Z" }),
      ],
      undefined,
      now,
      researched("2026-11-05T00:00:00Z"),
    );
    expect(list.map((t) => [t.jobId, t.kind])).toEqual([
      ["2", "next_step"],
      ["2", "interview_prep"],
      ["3", "expiring"],
      ["1", "follow_up"],
    ]);
  });

  it("asks once per company for research of active offers, and again when it is old", () => {
    const jobs = [job({ id: "1", status: "interesting" }), job({ id: "2", status: "applied", statusChangedAt: "2026-11-09T00:00:00Z" }), job({ id: "3" })];
    expect(todos(jobs, undefined, now).filter((t) => t.kind === "research").map((t) => t.jobId)).toEqual(["1"]);
    expect(todos(jobs, undefined, now, researched("2026-08-01T00:00:00Z")).some((t) => t.kind === "research")).toBe(true);
  });
});

describe("staleness", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const at = { foundAt: "2026-11-09T00:00:00Z" };
  it("flags long-listed and repeatedly re-published offers", () => {
    expect(staleness({ ...at, firstPublishedAt: "2026-11-01T00:00:00Z" }, now)).toBeUndefined();
    expect(staleness({ ...at, firstPublishedAt: "2026-09-20T00:00:00Z" }, now)).toMatchObject({ level: "old", days: 51 });
    expect(staleness({ ...at, firstPublishedAt: "2026-09-20T00:00:00Z", refreshCount: 2 }, now)?.text).toBe("Możliwa oferta-widmo: wystawiana od 51 dni, odświeżana 2×");
    expect(staleness({ ...at, firstPublishedAt: "2026-07-01T00:00:00Z" }, now)?.level).toBe("ghost");
  });
});
