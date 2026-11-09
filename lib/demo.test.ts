import { describe, expect, it } from "vitest";
import { addDemo, demoCount, removeDemo } from "./demo";
import type { Db, Job } from "./types";

const real: Job = {
  id: "r1", key: "acme|java", title: "Java Developer", company: "Acme", url: "u", source: "justjoin", links: [], salaries: [], skills: [],
  foundAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", status: "applied", statusChangedAt: "2026-11-01T00:00:00Z",
};

describe("demo data", () => {
  it("adds marked test records and removes only them", () => {
    const plan = { items: [{ skill: "Go", why: "", project: "", resources: [] }], createdAt: "2026-11-01T00:00:00Z" };
    const db: Db = { version: 0, jobs: { r1: real }, scans: [], learningPlan: plan };
    const n = addDemo(db, Date.parse("2026-11-10T12:00:00Z"));
    expect(n).toBeGreaterThan(5);
    expect(demoCount(db)).toBe(n);
    expect(Object.values(db.jobs).filter((j) => j.demo).every((j) => j.id.startsWith("demo-") && j.key.startsWith("demo|"))).toBe(true);
    // The user's own learning plan is kept, not replaced by the test one.
    expect(db.learningPlan).toBe(plan);
    expect(Object.values(db.companies ?? {}).every((c) => c.demo)).toBe(true);

    // Loading again does not duplicate.
    addDemo(db);
    expect(demoCount(db)).toBe(n);

    expect(removeDemo(db)).toBe(n);
    expect(Object.keys(db.jobs)).toEqual(["r1"]);
    expect(db.learningPlan).toBe(plan);
    expect(db.companies).toEqual({});
  });

  it("brings its own learning plan only when there is none, and takes it away again", () => {
    const db: Db = { version: 0, jobs: {}, scans: [] };
    addDemo(db);
    expect(db.learningPlan?.demo).toBe(true);
    removeDemo(db);
    expect(db.learningPlan).toBeUndefined();
  });
});
