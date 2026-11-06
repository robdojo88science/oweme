import type { Installment } from "../core/model";
import { daysBetween } from "../core/logic";

/** Actual/365 cash-flow yield; an explanatory estimate, not a statutory APR. */
export function loanCost(
  cashReleased: number,
  financeCharge: number,
  releaseDate: string,
  installments: Pick<Installment, "dueDate" | "amountDue">[],
) {
  if (cashReleased <= 0 || !installments.length) return undefined;
  const flows = installments.map((item) => ({
    amount: item.amountDue,
    years: daysBetween(releaseDate, item.dueDate) / 365,
  }));
  if (flows.some((item) => item.years <= 0)) return undefined;
  const presentValue = (rate: number) =>
    flows.reduce(
      (sum, item) =>
        sum + item.amount * Math.exp(-Math.log1p(rate) * item.years),
      0,
    );
  let lower = 0;
  let upper = 1;
  while (presentValue(upper) > cashReleased && upper < 1e12) upper *= 2;
  if (presentValue(upper) > cashReleased) return undefined;
  for (let step = 0; step < 100; step++) {
    const middle = (lower + upper) / 2;
    if (presentValue(middle) > cashReleased) lower = middle;
    else upper = middle;
  }
  return {
    costOfCashPercent: (financeCharge / cashReleased) * 100,
    effectiveAnnualPercent: ((lower + upper) / 2) * 100,
  };
}
