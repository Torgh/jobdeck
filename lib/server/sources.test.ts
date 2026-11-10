import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROFILE, type Db } from "../types";
import { ingest } from "./ingest";
import { jobDescription, ldPosting, linkedInJobId, offerFromLd, offerFromLink, parseLinkedInPosting, searchLink } from "./sources";

// Shaped like LinkedIn's public job page (jobs-guest/jobs/api/jobPosting/<id>), trimmed.
const LI_POSTING = `
<h2 class="top-card-layout__title font-sans text-lg topcard__title">Frontend Developer
</h2>
<h4 class="top-card-layout__second-subline">
  <span class="topcard__flavor">
    <a class="topcard__org-name-link topcard__flavor--black-link" href="https://pl.linkedin.com/company/acme">
      Acme &amp; Co
    </a>
  </span>
  <span class="topcard__flavor topcard__flavor--bullet">
    Wrocław, Dolnośląskie, Poland
  </span>
</h4>
<div class="show-more-less-html__markup">
  <p>We build <strong>React</strong> apps.</p><ul><li>TypeScript</li><li>Remote-friendly</li></ul>
</div>
<ul><li>
  <h3 class="description__job-criteria-subheader">Seniority level</h3>
  <span class="description__job-criteria-text">Mid-Senior level</span>
</li></ul>`;

describe("links the user pastes", () => {
  it("finds the LinkedIn job id in its link forms", () => {
    expect(linkedInJobId("https://www.linkedin.com/jobs/view/4487911915/?trk=x")).toBe("4487911915");
    expect(linkedInJobId("https://pl.linkedin.com/jobs/view/frontend-developer-at-acme-4487911915")).toBe("4487911915");
    expect(linkedInJobId("https://www.linkedin.com/comm/jobs/view/4487911915")).toBe("4487911915");
    expect(linkedInJobId("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4487911915")).toBe("4487911915");
    expect(linkedInJobId("https://www.linkedin.com/company/acme")).toBeUndefined();
    expect(linkedInJobId("https://example.com/jobs/view/4487911915")).toBeUndefined();
  });

  it("reads an offer from LinkedIn's public job page", () => {
    const job = parseLinkedInPosting(LI_POSTING, "4487911915");
    expect(job).toMatchObject({
      title: "Frontend Developer",
      company: "Acme & Co",
      location: "Wrocław, Dolnośląskie, Poland",
      url: "https://www.linkedin.com/jobs/view/4487911915",
      externalId: "4487911915",
      source: "linkedin",
    });
    expect(job?.description).toContain("• TypeScript");
    expect(job?.description).toContain("Seniority level: Mid-Senior level");
    expect(parseLinkedInPosting("<html>Sign in</html>", "1")).toBeUndefined();
  });

  it("reads an offer from a page's JobPosting data", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "Site" },
        {
          "@type": "JobPosting",
          title: "Senior Java Developer",
          hiringOrganization: { "@type": "Organization", name: "Beta S.A." },
          jobLocation: [{ address: { addressLocality: "Kraków" } }, { address: { addressLocality: "Kraków" } }],
          baseSalary: { currency: "PLN", value: { minValue: 20000, maxValue: 26000, unitText: "MONTH" } },
          description: "&lt;p&gt;Spring &amp;amp; Kafka&lt;/p&gt;",
          datePosted: "2026-11-02",
        },
      ],
    })}</script>`;
    const p = ldPosting(html);
    const job = p && offerFromLd(p, "https://career.beta.pl/oferty/1", "other");
    expect(job).toMatchObject({ title: "Senior Java Developer", company: "Beta S.A.", location: "Kraków", seniority: "senior" });
    expect(job?.salaries?.[0]).toMatchObject({ min: 20000, max: 26000, currency: "PLN", period: "month" });
    expect(job?.description).toBe("Spring & Kafka");
    expect(job?.publishedAt).toBe("2026-11-02T00:00:00.000Z");
    expect(ldPosting("<p>nothing</p>")).toBeUndefined();
  });

  it("never fetches portals that block automated requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const url of ["https://www.pracuj.pl/praca/dev,oferta,1004", "https://theprotocol.it/szczegoly/praca/x"]) {
      const r = await offerFromLink(url);
      expect(r.ok).toBe(false);
      await expect(jobDescription({ url, source: "pracuj" })).rejects.toThrow(/zrzut/);
    }
    expect((await offerFromLink("nie link")).ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("offers from screenshots", () => {
  const emptyDb = (): Db => ({ version: 0, jobs: {}, scans: [] });

  it("links to a search until the real link arrives, then fills in the card", async () => {
    const db = emptyDb();
    const url = searchLink("Frontend Developer", "Acme", "linkedin");
    expect(url).toContain("linkedin.com/jobs/search/");
    ingest(db, [{ title: "Frontend Developer", company: "Acme", url, source: "linkedin" }], DEFAULT_PROFILE, { PLN: 1 });
    await expect(jobDescription(Object.values(db.jobs)[0])).rejects.toThrow(/zrzut/);

    const r = ingest(
      db,
      [{ ...parseLinkedInPosting(LI_POSTING, "4487911915")!, company: "Acme" }],
      DEFAULT_PROFILE,
      { PLN: 1 },
    );
    expect(r.merged).toBe(1);
    const job = Object.values(db.jobs)[0];
    expect(job.url).toBe("https://www.linkedin.com/jobs/view/4487911915");
    expect(job.links).toEqual([{ source: "linkedin", url: "https://www.linkedin.com/jobs/view/4487911915" }]);
    expect(job.externalId).toBe("4487911915");
    expect(job.description).toContain("React");
  });
});
