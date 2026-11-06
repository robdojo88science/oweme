import { describe, expect, it } from "vitest";
import { schedule } from "../core/logic";
import { loanCost } from "./loanCost";

describe("transparent equivalent loan costs", () => {
  it("distinguishes a 10% face deduction from the cost of the cash received", () => {
    const items = schedule(300_000, 3, "2026-11-05", 5);
    const costs = loanCost(270_000, 30_000, "2026-11-05", items);
    expect(costs?.costOfCashPercent).toBeCloseTo(11.1111, 3);
    expect(costs?.effectiveAnnualPercent).toBeGreaterThan(85);
    expect(costs?.effectiveAnnualPercent).toBeLessThan(95);
  });

  it("reports zero equivalent cost on a zero-charge schedule", () => {
    const costs = loanCost(
      300_000,
      0,
      "2026-11-05",
      schedule(300_000, 3, "2026-11-05", 5),
    );
    expect(costs?.costOfCashPercent).toBe(0);
    expect(costs?.effectiveAnnualPercent).toBeCloseTo(0, 8);
  });

  it("does not invent annualized rates for missing cash or invalid cash flows", () => {
    expect(loanCost(0, 0, "2026-11-05", [])).toBeUndefined();
    expect(
      loanCost(100, 0, "2026-11-05", [
        { dueDate: "2026-11-05", amountDue: 100 },
      ]),
    ).toBeUndefined();
  });
});
