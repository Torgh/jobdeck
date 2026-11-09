import { describe, expect, it } from "vitest";
import { bestMonthly, formatSalary, normalizeSalary, parseSalaryText } from "./salary";

describe("salary", () => {
  it("normalises hourly B2B rates to a monthly PLN range", () => {
    const s = normalizeSalary({ min: 140, max: 160, currency: "PLN", period: "hour", contract: "b2b" });
    expect(s.monthlyPln).toEqual({ min: 23500, max: 26900 });
    expect(formatSalary(s)).toBe("140–160 PLN/h (≈ 23,5k–26,9k PLN/mies.) B2B");
  });

  it("converts foreign currencies with the given rates", () => {
    const s = normalizeSalary({ min: 5000, max: 6000, currency: "€", period: "month" }, { PLN: 1, EUR: 4 });
    expect(s.currency).toBe("EUR");
    expect(s.monthlyPln).toEqual({ min: 20000, max: 24000 });
  });

  it("parses Polish salary texts", () => {
    expect(parseSalaryText("160–230 zł netto (+ VAT) / godz.")).toEqual({
      min: 160,
      max: 230,
      currency: "PLN",
      period: "hour",
      gross: false,
      contract: "b2b",
    });
    expect(parseSalaryText("15 000 - 20 000 PLN brutto / mies.", "uop")).toMatchObject({
      min: 15000,
      max: 20000,
      period: "month",
      gross: true,
      contract: "uop",
    });
    expect(parseSalaryText("bez widełek")).toBeUndefined();
  });

  it("picks the best monthly range", () => {
    expect(
      bestMonthly([
        { currency: "PLN", period: "month", monthlyPln: { min: 10000, max: 12000 } },
        { currency: "PLN", period: "hour", monthlyPln: { min: 20000, max: 25000 } },
      ]),
    ).toEqual({ min: 20000, max: 25000 });
    expect(bestMonthly([])).toBeUndefined();
  });
});
