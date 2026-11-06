import { addDays, balance, mulDivRound } from "../core/logic";
import type { Transaction } from "../core/model";
import type { AppData } from "./types";

export function liveTransactions(transactions: Transaction[]) {
  const reversed = new Set(
    transactions.filter((t) => t.type === "VOID").map((t) => t.voidOf),
  );
  return transactions.filter((t) => t.type !== "VOID" && !reversed.has(t.id));
}

export function summarize(
  data: AppData,
  from: string,
  to: string,
  date: string,
) {
  const valid = liveTransactions(data.transactions);
  const inRange = (d: string) => d >= from && d <= to;
  const open = data.loans.filter((l) => l.status === "active");
  const due = open
    .flatMap((l) => l.installments)
    .filter((i) => i.status !== "rolled_over" && i.amountPaid < i.amountDue);
  const remaining = (items: typeof due) =>
    items.reduce((s, i) => s + i.amountDue - i.amountPaid, 0);
  const collected = valid
    .filter((t) => t.type === "PAYMENT" && inRange(t.date))
    .reduce((s, t) => s + t.amount, 0);
  const released = valid
    .filter((t) => ["RELEASE", "ADVANCE"].includes(t.type) && inRange(t.date))
    .reduce((s, t) => s + t.amount, 0);
  // Recognize the charge proportionally as repayment obligations are settled.
  // Cumulative rounding avoids counting the same centavo twice on partial payments.
  let charges = 0;
  const paymentTotals = new Map<string, { before: number; through: number }>();
  const totalApplied = new Map<string, number>();
  for (const t of valid) {
    if (t.type !== "PAYMENT") continue;
    const sums = paymentTotals.get(t.loanId) || { before: 0, through: 0 };
    const amount = t.allocation.reduce((a, p) => a + p.amount, 0);
    totalApplied.set(t.loanId, (totalApplied.get(t.loanId) || 0) + amount);
    if (t.date < from) sums.before += amount;
    if (t.date <= to) sums.through += amount;
    paymentTotals.set(t.loanId, sums);
  }
  const loanMap = new Map(data.loans.map((l) => [l.id, l]));
  const releases = new Map(
    valid.filter((t) => t.type === "ADVANCE").map((t) => [t.loanId, t]),
  );
  const bases = new Map<string, number>();
  // Merging carries unpaid obligations, including their unrecognized charge.
  // Keep that recognition basis separate from the new advance's disclosed charge.
  function chargeBasis(id: string, visiting = new Set<string>()): number {
    if (bases.has(id)) return bases.get(id)!;
    const loan = loanMap.get(id);
    if (!loan || visiting.has(id)) return 0;
    visiting.add(id);
    let amount = loan.interestAmount;
    const advance = releases.get(id)?.advance;
    if (advance?.mode === "merge") {
      const previous = loanMap.get(advance.previousLoanId);
      if (previous && previous.faceAmount > 0) {
        const basis = chargeBasis(previous.id, visiting);
        const earned = mulDivRound(
          Math.min(previous.faceAmount, totalApplied.get(previous.id) || 0),
          basis,
          previous.faceAmount,
        );
        amount += basis - earned;
      }
    }
    visiting.delete(id);
    bases.set(id, amount);
    return amount;
  }
  for (const loan of data.loans) {
    if (loan.status === "voided" || loan.faceAmount <= 0) continue;
    const sums = paymentTotals.get(loan.id) || { before: 0, through: 0 };
    const basis = chargeBasis(loan.id);
    charges +=
      mulDivRound(
        Math.min(loan.faceAmount, sums.through),
        basis,
        loan.faceAmount,
      ) -
      mulDivRound(
        Math.min(loan.faceAmount, sums.before),
        basis,
        loan.faceAmount,
      );
  }
  return {
    outstanding: open.reduce((s, l) => s + balance(l), 0),
    openCash: open.reduce((s, l) => s + l.netRelease, 0),
    activeLoans: open.length,
    activeBorrowers: new Set(open.map((l) => l.borrowerId)).size,
    activeFace: open.reduce((s, l) => s + l.faceAmount, 0),
    expected: data.loans
      .filter((l) => l.status !== "voided")
      .flatMap((l) => l.installments)
      .filter((i) => i.status !== "rolled_over" && inRange(i.dueDate))
      .reduce((s, i) => s + i.amountDue, 0),
    reversalTotal: data.transactions
      .filter((t) => t.type === "VOID" && inRange(t.date))
      .reduce((s, t) => s + t.amount, 0),
    collected,
    released,
    charges,
    cashFlow: collected - released,
    overdue: remaining(due.filter((i) => i.dueDate < date)),
    dueToday: remaining(due.filter((i) => i.dueDate === date)),
    upcoming: remaining(
      due.filter((i) => i.dueDate > date && i.dueDate <= addDays(date, 7)),
    ),
  };
}
