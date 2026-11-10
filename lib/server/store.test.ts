import path from "node:path";
import { describe, expect, it } from "vitest";
import { dataDirFrom } from "./store";

describe("data folder", () => {
  const home = path.join("/home", "u");
  const none = () => false;
  const only = (...dirs: string[]) => (p: string) => dirs.includes(p);

  it("uses TROPICIEL_HOME, then the old JOBDECK_HOME", () => {
    expect(dataDirFrom({ TROPICIEL_HOME: "/a", JOBDECK_HOME: "/b" }, home, none)).toBe("/a");
    expect(dataDirFrom({ JOBDECK_HOME: "/b" }, home, none)).toBe("/b");
  });

  it("defaults to ~/.tropiciel, but keeps an existing ~/.jobdeck", () => {
    expect(dataDirFrom({}, home, none)).toBe(path.join(home, ".tropiciel"));
    expect(dataDirFrom({}, home, only(path.join(home, ".jobdeck")))).toBe(path.join(home, ".jobdeck"));
    expect(dataDirFrom({}, home, only(path.join(home, ".jobdeck"), path.join(home, ".tropiciel")))).toBe(path.join(home, ".tropiciel"));
  });
});
