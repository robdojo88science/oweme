import { daysBetween } from "../core/logic";
import type { AppData } from "./types";
import { liveTransactions } from "./dashboard";

export function reportBreakdown(
  data: AppData,
  from: string,
  to: string,
  asOf: string,
) {
  const transactions = liveTransactions(data.transactions).filter(
    (t) => t.date >= from && t.date <= to,
  );
  const payments = transactions.filter((t) => t.type === "PAYMENT");
  const channelTotals = new Map<string, number>();
  for (const payment of payments) {
    const label = {
      cash: "Cash",
      bank: "Bank transfer",
      gcash: "GCash",
      maya: "Maya",
      other: "Other",
    }[payment.method || "other"];
    channelTotals.set(label, (channelTotals.get(label) || 0) + payment.amount);
  }
  const aging = [
    { label: "1–7 days", amount: 0 },
    { label: "8–30 days", amount: 0 },
    { label: "31–60 days", amount: 0 },
    { label: "61+ days", amount: 0 },
  ];
  const delinquent = new Set<string>();
  for (const loan of data.loans.filter((l) => l.status === "active"))
    for (const installment of loan.installments) {
      if (
        installment.status === "rolled_over" ||
        installment.amountPaid >= installment.amountDue ||
        installment.dueDate >= asOf
      )
        continue;
      const days = daysBetween(installment.dueDate, asOf);
      aging[days <= 7 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : 3].amount +=
        installment.amountDue - installment.amountPaid;
      delinquent.add(loan.borrowerId);
    }
  return {
    transactions,
    channels: [...channelTotals.entries()].map(([label, amount]) => ({
      label,
      amount,
    })),
    aging,
    delinquentBorrowers: delinquent.size,
    unappliedCredit: payments.reduce(
      (sum, t) => sum + (t.unappliedAmount || 0),
      0,
    ),
    settledLoans: data.loans.filter((l) => {
      const settledDate = l.installments
        .map((i) => i.paidDate || "")
        .sort()
        .at(-1);
      return (
        l.status === "completed" &&
        l.installments.every((i) => i.amountPaid >= i.amountDue) &&
        Boolean(settledDate && settledDate >= from && settledDate <= to)
      );
    }).length,
  };
}

/** Quote every value and neutralize spreadsheet formulas in user-entered fields. */
export function csvRows(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          let text = String(value);
          if (typeof value === "string" && /^[=+\-@\t\r]/.test(text))
            text = `'${text}`;
          return `"${text.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
}
