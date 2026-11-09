import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, type Db } from "../types";
import { ingest } from "./ingest";
import { mapJustJoin, mapNoFluff, parseLinkedInCards } from "./sources";

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
