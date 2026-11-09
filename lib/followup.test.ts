import { describe, expect, it } from "vitest";
import { applicantName, followUpDraft, followUpState, offerLanguage } from "./followup";
import type { Job } from "./types";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const base = { status: "applied" as const, statusChangedAt: "2026-11-01T09:00:00Z", appliedAt: "2026-11-01" };

describe("followUpState", () => {
  it("is due after 7 quiet days, counts reminders and gives up after two", () => {
    expect(followUpState(base, NOW)).toMatchObject({ due: true, count: 0, quietDays: 9 });
    expect(followUpState({ ...base, statusChangedAt: "2026-11-06T09:00:00Z" }, NOW)?.due).toBe(false);
    const one = { ...base, events: [{ at: "2026-11-08T10:00:00Z", kind: "follow_up" as const, text: "" }] };
    expect(followUpState(one, NOW)).toMatchObject({ due: false, count: 1, quietDays: 2 });
    expect(followUpState(one, Date.parse("2026-11-16T12:00:00Z"))?.due).toBe(true);
    const two = { ...base, events: [one.events[0], { at: "2026-11-09T10:00:00Z", kind: "follow_up" as const, text: "" }] };
    expect(followUpState(two, Date.parse("2026-11-20T12:00:00Z"))).toMatchObject({ due: false, giveUp: true });
  });

  it("is quiet when there is a next step or the card moved on", () => {
    expect(followUpState({ ...base, nextStep: { text: "Rozmowa" } }, NOW)?.due).toBe(false);
    expect(followUpState({ ...base, status: "interview" }, NOW)).toBeUndefined();
  });
});

describe("followUpDraft", () => {
  const job: Pick<Job, "title" | "company" | "appliedAt" | "statusChangedAt" | "events" | "documents" | "description" | "summary"> = {
    ...base,
    title: "Java Developer",
    company: "Acme",
    description: "Szukamy osoby do zespołu. Wymagania: Java, Spring. Oferujemy pracę zdalną i rozwój w zespole.",
  };

  it("writes a Polish reminder with the date, the role and the matching skills", () => {
    const d = followUpDraft(job, { name: "Jan Kowalski", matched: ["Java", "Spring", "SQL"] });
    expect(d.language).toBe("pl");
    expect(d.subject).toBe("Aplikacja na stanowisko Java Developer – pytanie o status");
    expect(d.body).toContain("przesłanej 01.11.2026");
    expect(d.body).toContain("z Java i Spring");
    expect(d.body.endsWith("Jan Kowalski")).toBe(true);
  });

  it("switches to English and to a second reminder", () => {
    const en = { ...job, description: "We are looking for a developer to join our team. You will work with Java and the experience matters." };
    const d = followUpDraft({ ...en, events: [{ at: "2026-11-08T10:00:00Z", kind: "follow_up", text: "" }] });
    expect(d.language).toBe("en");
    expect(d.subject.startsWith("Follow-up:")).toBe(true);
    expect(d.body).toContain("[Your name]");
  });
});

describe("helpers", () => {
  it("guesses the language and the applicant's name", () => {
    expect(offerLanguage({ title: "Dev", documents: { letter: { markdown: "x", updatedAt: "", language: "en" } } })).toBe("en");
    expect(applicantName({ documents: { cv: { markdown: "# Anna Nowak\nkontakt", updatedAt: "" } } })).toBe("Anna Nowak");
    expect(applicantName({}, "Piotr Wiśniewski\nSenior Java Developer")).toBe("Piotr Wiśniewski");
    expect(applicantName({}, "CURRICULUM VITAE – 2026")).toBeUndefined();
  });
});
