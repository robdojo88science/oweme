import { describe, expect, it } from "vitest";
import { summarize } from "./dashboard";
import { schedule } from "../core/logic";
import { defaultSettings } from "../data/db";
import type { Loan, Transaction } from "../core/model";
import type { AppData } from "./types";

function fixture() {
  const loan = {
    id: "loan",
    borrowerId: "borrower",
    status: "active",
    faceAmount: 300000,
    netRelease: 270000,
    interestAmount: 30000,
    installments: schedule(300000, 3, "2026-11-05", 5),
  } as Loan;
  const release = {
    id: "release",
    loanId: "loan",
    type: "RELEASE",
    date: "2026-11-05",
    amount: 270000,
    allocation: [],
  } as unknown as Transaction;
  return {
    settings: defaultSettings,
    borrowers: [],
    loans: [loan],
    transactions: [release],
    notes: [],
  } as AppData;
}
function payment(id: string, date: string, amount: number, applied = amount) {
  return {
    id,
    loanId: "loan",
    type: "PAYMENT",
    date,
    amount,
    allocation: [{ installmentNo: 1, amount: applied }],
    unappliedAmount: amount - applied,
  } as Transaction;
}
describe("dashboard accounting", () => {
  it("separates released cash, repayment obligation, and unearned charges", () => {
    const data = fixture();
    expect(
      summarize(data, "2026-11-01", "2026-11-30", "2026-11-06"),
    ).toMatchObject({
      outstanding: 300000,
      activeFace: 300000,
      openCash: 270000,
      released: 270000,
      collected: 0,
      charges: 0,
      cashFlow: -270000,
      activeLoans: 1,
      activeBorrowers: 1,
    });
  });
  it("counts a missed due date as overdue even inside courtesy", () => {
    const data = fixture();
    const m = summarize(data, "2026-12-01", "2026-12-06", "2026-12-06");
    expect(m.overdue).toBe(100000);
    expect(m.expected).toBe(100000);
  });
  it("recognizes applied repayment charges once and excludes unapplied credit", () => {
    const data = fixture();
    data.transactions.push(
      payment("p1", "2026-12-01", 50000),
      payment("p2", "2026-12-05", 60000, 50000),
    );
    expect(
      summarize(data, "2026-12-01", "2026-12-31", "2026-12-06"),
    ).toMatchObject({ collected: 110000, charges: 10000 });
    expect(
      summarize(data, "2026-12-05", "2026-12-31", "2026-12-06").charges,
    ).toBe(5000);
  });
  it("excludes reversed collections and preserves reversal totals", () => {
    const data = fixture();
    data.transactions.push(payment("p1", "2026-12-01", 50000), {
      id: "rev",
      type: "VOID",
      date: "2026-12-02",
      amount: 50000,
      voidOf: "p1",
    } as Transaction);
    expect(
      summarize(data, "2026-12-01", "2026-12-31", "2026-12-06"),
    ).toMatchObject({ collected: 0, charges: 0, reversalTotal: 50000 });
  });
});
