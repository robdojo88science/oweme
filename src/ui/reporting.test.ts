import { describe, expect, it } from "vitest";
import type { Loan, Transaction } from "../core/model";
import { defaultSettings } from "../data/db";
import type { AppData } from "./types";
import { csvRows, reportBreakdown } from "./reporting";

const meta = {
  id: "loan",
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: "2026-11-05T00:00:00Z",
};
const loan: Loan = {
  ...meta,
  loanNo: "L-001-01",
  borrowerId: "b1",
  borrowerSnapshot: { numericId: 1, fullName: "Account" },
  incomeAtLoan: 100000,
  termMonths: 1,
  rate: 0.1,
  interestMode: "upfront",
  faceAmount: 100000,
  interestAmount: 10000,
  netRelease: 90000,
  monthlyAmount: 100000,
  releaseDate: "2026-11-05",
  status: "active",
  installments: [
    {
      no: 1,
      dueDate: "2026-12-05",
      graceUntil: "2026-12-10",
      amountDue: 100000,
      amountPaid: 20000,
      status: "Mercy",
    },
  ],
  kind: "new",
  releasedBy: "Owner",
  signatures: {},
};
const payment: Transaction = {
  ...meta,
  id: "p1",
  txnNo: "OWM-PAY-2026-000001",
  type: "PAYMENT",
  loanId: "loan",
  borrowerId: "b1",
  borrowerSnapshot: loan.borrowerSnapshot,
  amount: 20000,
  allocation: [{ installmentNo: 1, amount: 20000 }],
  method: "gcash",
  receivedBy: "Owner",
  balanceBefore: 100000,
  balanceAfter: 80000,
  date: "2026-12-06",
};
const data: AppData = {
  borrowers: [],
  loans: [loan],
  transactions: [payment],
  notes: [],
  settings: defaultSettings,
};

describe("owner report details", () => {
  it("counts contractual arrears during courtesy days and includes archived/deleted-account history", () => {
    const report = reportBreakdown(
      data,
      "2026-12-01",
      "2026-12-31",
      "2026-12-07",
    );
    expect(report.aging[0].amount).toBe(80000);
    expect(report.delinquentBorrowers).toBe(1);
    expect(report.channels).toEqual([{ label: "GCash", amount: 20000 }]);
  });
  it("does not count reversed original repayments or the reversal as new cash", () => {
    const report = reportBreakdown(
      {
        ...data,
        transactions: [
          payment,
          { ...payment, id: "r1", type: "VOID", voidOf: "p1" },
        ],
      },
      "2026-12-01",
      "2026-12-31",
      "2026-12-07",
    );
    expect(report.channels).toEqual([]);
    expect(report.transactions).toEqual([]);
  });
  it("escapes spreadsheet formulas, quotations and row breaks in CSV", () => {
    expect(csvRows([["=SUM(A1)", 'A "quoted" name', "line\nbreak", -10]])).toBe(
      '"\'=SUM(A1)","A ""quoted"" name","line\nbreak","-10"',
    );
  });
});
