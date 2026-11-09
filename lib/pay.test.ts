import { describe, expect, it } from "vitest";
import { b2bEquivalent, b2bNet, DEFAULT_B2B, onHandRange, uopNet } from "./pay";

describe("uopNet (2026)", () => {
  it("matches a hand calculation for 10 000 zł gross", () => {
    // social 16 452 / yr, health 9 % of 103 548, PIT on 100 548 → 8 466; net 85 762.68 / 12
    expect(uopNet(10_000).net).toBeCloseTo(7146.89, 1);
  });

  it("stops pension and disability contributions above the 30× cap", () => {
    const high = uopNet(30_000);
    const zus = high.parts.find((p) => p.label.startsWith("ZUS"))!.amount;
    // 282 600 × 11.26 % + 360 000 × 2.45 % = 40 640.76 / yr
    expect(zus).toBeCloseTo(40_640.76 / 12, 1);
  });

  it("uses higher costs for commuters", () => {
    expect(uopNet(10_000, { commuting: true }).net).toBeGreaterThan(uopNet(10_000).net);
  });
});

describe("b2bNet (2026)", () => {
  it("ryczałt 12 %, full ZUS, 300 zł costs", () => {
    // ZUS 19 797.85 + FP 1 661.69, health 9 966.96 (middle tier), tax 25 826
    expect(b2bNet(20_000).net).toBeCloseTo(14_928.96, 0);
  });

  it("flat tax 19 % with the health deduction", () => {
    expect(b2bNet(20_000, { ...DEFAULT_B2B, form: "liniowy" }).net).toBeCloseTo(13_797.53, 0);
  });

  it("moves to the top ryczałt health tier above 300 000 zł a year", () => {
    const parts = (v: number) => b2bNet(v).parts.find((p) => p.label === "Składka zdrowotna")!.amount;
    expect(parts(25_000)).toBeCloseTo(830.58, 2);
    expect(parts(26_000)).toBeCloseTo(1495.04, 2);
  });

  it("pays the minimum health contribution on low income", () => {
    const h = b2bNet(3000, { ...DEFAULT_B2B, form: "skala", zus: "start" }).parts.find((p) => p.label === "Składka zdrowotna")!.amount;
    expect(h).toBeCloseTo(432.54, 2);
  });

  it("is lower with unpaid days and with sickness insurance", () => {
    expect(b2bNet(20_000, { ...DEFAULT_B2B, unpaidDays: 26 }).net).toBeLessThan(b2bNet(20_000).net - 1500);
    expect(b2bNet(20_000, { ...DEFAULT_B2B, sickness: true }).net).toBeLessThan(b2bNet(20_000).net);
    expect(b2bNet(20_000, { ...DEFAULT_B2B, zus: "preferential" }).net).toBeGreaterThan(b2bNet(20_000).net);
  });
});

describe("comparisons", () => {
  it("finds the invoice equal to a UoP salary", () => {
    const inv = b2bEquivalent(15_000);
    expect(b2bNet(inv).net).toBeGreaterThanOrEqual(uopNet(15_000).net);
    expect(b2bNet(inv - 20).net).toBeLessThan(uopNet(15_000).net);
  });

  it("estimates an offer's range by contract", () => {
    expect(onHandRange({ contract: "uop", gross: true, monthlyPln: { min: 10_000, max: 12_000 } })).toEqual({ min: 7147, max: uopNet(12_000).net && Math.round(uopNet(12_000).net) });
    expect(onHandRange({ contract: "b2b", monthlyPln: { min: 20_000 } })).toEqual({ min: 14_929, max: undefined });
    expect(onHandRange({ contract: "uz", monthlyPln: { min: 1 } })).toBeUndefined();
    expect(onHandRange({ contract: "uop", gross: false, monthlyPln: { min: 1 } })).toBeUndefined();
  });
});
