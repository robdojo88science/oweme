import { describe, expect, it } from "vitest";
import type { Borrower, Loan, Settings, Transaction } from "../core/model";
import {
  calendarText,
  publicText,
  receiptLines,
  receiptSignatures,
  reminderText,
} from "./public";
import { schedule } from "../core/logic";

const meta = {
  id: "fixture",
  createdAt: "2026-11-05T01:00:00.000Z",
  updatedAt: "2026-11-05T01:00:00.000Z",
};
const settings: Settings = {
  ...meta,
  business: { name: "OweMe", address: "Barangay Uno" },
  defaults: { rate: 0.1, maxTerm: 3, graceDays: 5, interestMode: "upfront" },
  scoring: {
    onTime: 100,
    withinGrace: 85,
    lateBase: 70,
    latePerDay: 4,
    minimum: 10,
    recency: 0.9,
  },
  backup: {},
  haptics: true,
  receiptFooter: "Salamat!",
  agreementText: "I received this cash.",
  reminderTemplate:
    "Hello {name}, {amount} is due on {dueDate}. Thank you! - {business}",
  adminEmail: "",
  defaultReceivedBy: "Lender",
  borrowerPrefix: "",
};
const borrower: Borrower = {
  ...meta,
  numericId: 1,
  fullName: "José, Dela Cruz",
  address: "Purok 1",
  monthlyIncome: 100000,
  status: "active",
};
const loan: Loan = {
  ...meta,
  loanNo: "L-001-01",
  borrowerId: borrower.id,
  borrowerSnapshot: { numericId: 1, fullName: borrower.fullName },
  incomeAtLoan: 100000,
  termMonths: 3,
  rate: 0.1,
  interestMode: "upfront",
  faceAmount: 300000,
  interestAmount: 30000,
  netRelease: 270000,
  monthlyAmount: 100000,
  releaseDate: "2026-11-30",
  status: "active",
  installments: schedule(300000, 3, "2026-11-30", 5),
  kind: "new",
  releasedBy: "Lender",
  signatures: {},
};
const txn: Transaction = {
  ...meta,
  txnNo: "OM-20261105-0001",
  type: "PAYMENT",
  loanId: loan.id,
  borrowerId: borrower.id,
  borrowerSnapshot: loan.borrowerSnapshot,
  amount: 50000,
  method: "gcash",
  referenceNo: "GC-123",
  receivedBy: "Lender",
  balanceBefore: 300000,
  balanceAfter: 250000,
  allocation: [{ installmentNo: 1, amount: 50000 }],
  date: "2026-11-05",
};

describe("borrower-facing privacy boundary", () => {
  it("removes any sentence that exposes internal payment policies", () => {
    expect(
      publicText(
        "Please pay on December 5. Mercy period is five days. Thank you!",
      ),
    ).toBe("Please pay on December 5.\nThank you!");
    expect(
      publicText("graceUntil: 2026-12-10\nOfficial due date: 2026-12-05"),
    ).toBe("Official due date: 2026-12-05");
  });
  it("preserves borrowers whose names include Grace or Mercy", () => {
    expect(publicText("Grace Santos")).toBe("Grace Santos");
    expect(publicText("Mercy Dela Cruz")).toBe("Mercy Dela Cruz");
    expect(publicText("Thank you, Grace!")).toBe("Thank you, Grace!");
  });
  it("does not retroactively attach current loan signatures to an unsigned payment receipt", () => {
    const signature = {
      original: new Blob(),
      processed: new Blob(),
      signerName: "Grace Santos",
      capturedAt: meta.createdAt,
    };
    const signedLoan = {
      ...loan,
      signatures: { borrower: signature, admin: signature },
    };
    expect(receiptSignatures(txn, signedLoan)).toEqual({
      payer: undefined,
      receiver: undefined,
    });
    expect(
      receiptSignatures({ ...txn, type: "RELEASE" }, signedLoan).receiver,
    ).toBe(signature);
  });
  it("selects public receipt fields and includes the stable balances and reference", () => {
    const rows = receiptLines(txn, loan, settings);
    expect(rows).toContainEqual(["Balance before", "₱3,000.00"]);
    expect(rows).toContainEqual(["Balance after", "₱2,500.00"]);
    expect(rows).toContainEqual(["Reference", "GC-123"]);
    expect(JSON.stringify(rows)).not.toMatch(/mercy|grace|frozenScore/i);
  });
  it("fills the reminder template with official dates only", () => {
    const text = reminderText(borrower, loan, settings);
    expect(text).toContain("2026-12-30");
    expect(text).toContain("₱1,000.00");
    expect(text).not.toMatch(/mercy|grace/i);
  });
});

describe("calendar export", () => {
  it("uses official all-day dates, stable identifiers and escaped names", () => {
    const text = calendarText([loan], settings, [borrower]);
    expect(text).toContain(
      "DTSTART;VALUE=DATE:20261230\r\nDTEND;VALUE=DATE:20261231",
    );
    expect(text).toContain("DTSTART;VALUE=DATE:20270228");
    expect(text).toContain("UID:fixture-1@oweme.local");
    expect(text).toContain("José\\, Dela Cruz");
    expect(text).not.toMatch(/mercy|grace/i);
    for (const line of text.split("\r\n"))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
  it("omits paid, rolled over, past-range and closed-loan dues", () => {
    const paid = {
      ...loan,
      installments: loan.installments.map((item, i) =>
        i === 0
          ? { ...item, amountPaid: item.amountDue, status: "Paid" as const }
          : item,
      ),
    };
    const text = calendarText(
      [paid, { ...loan, id: "closed", status: "merged" }],
      settings,
      [],
      "2027-01-01",
    );
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(text).not.toContain("closed-");
    expect(text).not.toContain("DTSTART;VALUE=DATE:20261230");
  });
});
