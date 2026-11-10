import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, type Db } from "../types";
import { ingest } from "./ingest";
import { mapBulldog, mapHimalayas, mapJustJoin, mapNoFluff, mapRemotive, openToPoland, parseLinkedInCards } from "./sources";

const rates = { PLN: 1 };
const emptyDb = (): Db => ({ version: 0, jobs: {}, scans: [] });

describe("ingest", () => {
  it("adds new offers and merges the same one from another portal", () => {
    const db = emptyDb();
    const a = ingest(
      db,
      [{ title: "Java Developer", company: "Acme sp. z o.o.", url: "https://a/1", source: "justjoin", skills: ["Java"] }],
      DEFAULT_PROFILE,
      rates,
    );
    expect(a.added).toHaveLength(1);
    const b = ingest(
      db,
      [
        {
          title: "Java Developer (m/f)",
          company: "ACME",
          url: "https://b/1",
          source: "nofluff",
          salaries: [{ min: 20000, max: 25000, currency: "PLN", period: "month" }],
        },
      ],
      DEFAULT_PROFILE,
      rates,
    );
    expect(b.added).toHaveLength(0);
    expect(b.merged).toBe(1);
    const job = Object.values(db.jobs)[0];
    expect(job.links.map((l) => l.source)).toEqual(["justjoin", "nofluff"]);
    expect(job.salaries[0].monthlyPln).toEqual({ min: 20000, max: 25000 });
  });

  it("skips filtered offers unless forced", () => {
    const db = emptyDb();
    const input = { title: "Junior Tester", company: "X", url: "https://x", source: "linkedin" as const };
    expect(ingest(db, [input], DEFAULT_PROFILE, rates).skipped).toHaveLength(1);
    expect(ingest(db, [input], DEFAULT_PROFILE, rates, { force: true }).added).toHaveLength(1);
  });
});

describe("source mappers", () => {
  it("maps Just Join IT offers (original currency only)", () => {
    const j = mapJustJoin({
      slug: "acme-java",
      title: "Java Dev",
      companyName: "Acme",
      city: "Warszawa",
      workplaceType: "hybrid",
      experienceLevel: "senior",
      publishedAt: "2026-11-09T07:30:04Z",
      employmentTypes: [
        { from: 23520, to: 26880, fromPerUnit: 140, toPerUnit: 160, currency: "PLN", currencySource: "original", type: "b2b", unit: "Hour", gross: false },
        { from: 20000, to: 25000, currency: "PLN", currencySource: "original", type: "permanent", gross: true },
        { from: 35, to: 40, currency: "USD", currencySource: "conversion", type: "b2b", unit: "Hour", gross: false },
      ],
      requiredSkills: [{ name: "Java" }, { name: "Kafka" }],
    });
    expect(j).toMatchObject({
      url: "https://justjoin.it/job-offer/acme-java",
      workMode: "hybrid",
      seniority: "senior",
      skills: ["Java", "Kafka"],
    });
    expect(j.salaries).toEqual([
      { min: 140, max: 160, currency: "PLN", period: "hour", contract: "b2b", gross: false },
      { min: 20000, max: 25000, currency: "PLN", period: "month", contract: "uop", gross: true },
    ]);
  });

  it("keeps every city of a Just Join IT offer and flags offers outside Poland", () => {
    const base = { slug: "s", title: "Engineering Manager", companyName: "Acme", workplaceType: "remote" };
    const multi = mapJustJoin({
      ...base,
      city: "Warszawa",
      locations: [
        { city: "Warszawa", latitude: 52.23, longitude: 21.01 },
        { city: "Wrocław", latitude: 51.11, longitude: 17.03 },
      ],
    });
    expect(multi).toMatchObject({ location: "Warszawa, Wrocław", abroad: false });
    expect(mapJustJoin({ ...base, city: "Monachium", latitude: 48.14, longitude: 11.58 }).abroad).toBe(true);
    expect(mapJustJoin({ ...base, city: "Lisbon", locations: [{ city: "Lisbon", latitude: "38.72", longitude: "-9.14" }] }).abroad).toBe(true);
    expect(mapJustJoin({ ...base, city: "Kraków" }).abroad).toBe(false);
  });

  it("maps No Fluff Jobs postings", () => {
    const j = mapNoFluff({
      id: "x",
      url: "remote-kotlin-acme",
      name: "Acme",
      title: "Kotlin Dev",
      posted: 1793978631259,
      seniority: ["Mid", "Senior"],
      location: { places: [{ city: "Remote" }], fullyRemote: true },
      salary: { from: 18000, to: 23000, type: "b2b", currency: "PLN", period: "Month" },
      tiles: {
        values: [
          { value: "backend", type: "category" },
          { value: "Kotlin", type: "requirement" },
        ],
      },
    });
    expect(j.location).toBeUndefined();
    expect(j).toMatchObject({
      workMode: "remote",
      seniority: "senior",
      skills: ["Kotlin"],
      url: "https://nofluffjobs.com/pl/job/remote-kotlin-acme",
    });
    expect(j.salaries?.[0]).toMatchObject({ min: 18000, max: 23000, contract: "b2b", period: "month" });
  });

  it("parses LinkedIn guest search cards", () => {
    const html = `<li><div data-entity-urn="urn:li:jobPosting:4487147398">
      <h3 class="base-search-card__title">  Java Cloud Developer (f/m/x) </h3>
      <h4 class="base-search-card__subtitle"><a href="#">Sii Poland</a></h4>
      <span class="job-search-card__location">Kraków, Małopolskie, Poland</span>
      <time class="job-search-card__listdate--new" datetime="2026-11-09">1 day ago</time></div></li><li>broken</li>`;
    expect(parseLinkedInCards(html)).toEqual([
      expect.objectContaining({
        title: "Java Cloud Developer (f/m/x)",
        company: "Sii Poland",
        externalId: "4487147398",
        url: "https://www.linkedin.com/jobs/view/4487147398",
        location: "Kraków, Małopolskie, Poland",
        publishedAt: "2026-11-09T00:00:00Z",
      }),
    ]);
  });
});

describe("publication history", () => {
  it("keeps the first publication date and counts re-publications", () => {
    const db: Db = { version: 0, jobs: {}, scans: [] };
    const base = { title: "Kotlin Dev", company: "Acme", url: "https://a/k", source: "justjoin" as const };
    ingest(db, [{ ...base, publishedAt: "2026-09-01T00:00:00Z", firstPublishedAt: "2026-08-15T00:00:00Z" }], DEFAULT_PROFILE, rates);
    ingest(db, [{ ...base, publishedAt: "2026-10-01T00:00:00Z" }], DEFAULT_PROFILE, rates);
    ingest(db, [{ ...base, publishedAt: "2026-10-01T06:00:00Z" }], DEFAULT_PROFILE, rates);
    ingest(db, [{ ...base, publishedAt: "2026-11-01T00:00:00Z" }], DEFAULT_PROFILE, rates);
    const job = Object.values(db.jobs)[0];
    expect(job.firstPublishedAt).toBe("2026-08-15T00:00:00Z");
    expect(job.refreshCount).toBe(2);
  });
});

describe("new sources", () => {
  it("maps Bulldogjob offers", () => {
    const j = mapBulldog({
      id: "260948-mobile-architect",
      position: "Mobile Solution Architect",
      company: { name: "TeamQuest", logo: { url: "https://cdn/logo.png" } },
      city: "Gdańsk",
      remote: false,
      experienceLevel: "medium",
      technologyTags: ["Kotlin", "Swift"],
      showSalary: true,
      denominatedSalaryLong: { money: "24 000 - 32 000", currency: "PLN" },
      contractB2b: true,
      contractEmployment: false,
    });
    expect(j).toMatchObject({ url: "https://bulldogjob.pl/companies/jobs/260948-mobile-architect", seniority: "mid", skills: ["Kotlin", "Swift"], logo: "https://cdn/logo.png" });
    expect(j.salaries?.[0]).toMatchObject({ min: 24000, max: 32000, currency: "PLN", period: "month", contract: "b2b" });
  });

  it("keeps remote offers open to Poland", () => {
    expect(openToPoland(undefined)).toBe(true);
    expect(openToPoland("Worldwide")).toBe(true);
    expect(openToPoland(["Czechia", "Poland"])).toBe(true);
    expect(openToPoland("Europe, CET +/- 2h")).toBe(true);
    expect(openToPoland("USA only")).toBe(false);
    expect(openToPoland(["Spain"])).toBe(false);
  });

  it("maps Remotive and Himalayas offers", () => {
    expect(mapRemotive({ id: 1, url: "https://remotive.com/x-1", title: "Senior Kotlin Engineer", company_name: "Acme", publication_date: "2026-11-07T01:10:55", candidate_required_location: "Europe" })).toMatchObject({
      source: "remotive",
      workMode: "remote",
      seniority: "senior",
      publishedAt: "2026-11-07T01:10:55Z",
    });
    const h = mapHimalayas({ title: "Team Lead Kotlin", companyName: "JetBrains", guid: "https://himalayas.app/j/1", minSalary: 90000, maxSalary: 120000, salaryPeriod: "annual", currency: "EUR", locationRestrictions: ["Poland"], pubDate: 1794236924 });
    expect(h.salaries?.[0]).toMatchObject({ min: 90000, max: 120000, period: "year", currency: "EUR" });
    expect(h.location).toBe("Poland");
  });
});
