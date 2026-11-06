import { readFile, mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { Borrower, Loan, Settings, Transaction } from "../core/model";
import { schedule } from "../core/logic";
import { loanSlipPDF, receiptPDF, reportPDF, statementPDF } from "./pdf";

const meta = {
  id: "pdf-fixture",
  createdAt: "2026-11-05T01:00:00.000Z",
  updatedAt: "2026-11-05T01:00:00.000Z",
};
const settings: Settings = {
  ...meta,
  business: {
    name: "OweMe Lending",
    address: "Purok 3, Barangay San Isidro, Quezon City",
  },
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
  receiptFooter: "Salamat! Please keep this for your records.",
  agreementText:
    "I understand the payment schedule above and acknowledge that I received the cash amount shown. Nauunawaan ko ang kasunduan at natanggap ko ang halagang nakasaad.",
  reminderTemplate: "",
  adminEmail: "",
  defaultReceivedBy: "Maria Santos",
  borrowerPrefix: "",
};
const borrower: Borrower = {
  ...meta,
  numericId: 1,
  fullName: "José Dela Cruz",
  address: "Purok 3, San Isidro",
  monthlyIncome: 100000,
  status: "active",
};
const loan: Loan = {
  ...meta,
  loanNo: "L-001-02",
  borrowerId: borrower.id,
  borrowerSnapshot: { numericId: 1, fullName: borrower.fullName },
  incomeAtLoan: 100000,
  termMonths: 3,
  rate: 0.1,
  interestMode: "upfront",
  faceAmount: 300000,
  interestAmount: 10000,
  netRelease: 90000,
  monthlyAmount: 100000,
  releaseDate: "2026-12-05",
  status: "active",
  installments: schedule(300000, 3, "2026-12-05", 5),
  kind: "advance",
  carriedBalance: 200000,
  advanceFace: 100000,
  autoNote:
    "Advance on 2026-12-05 · Balance carried ₱2,000 (L-001-01) + advance ₱1,000 (interest ₱100, cash ₱900) → merged into L-001-02 · ₱3,000 over 3 months, ₱1,000/month, first due 2027-01-05.",
  releasedBy: "Maria Santos",
  signatures: {},
};
const txn: Transaction = {
  ...meta,
  txnNo: "OM-20261205-0001",
  type: "ADVANCE",
  loanId: loan.id,
  borrowerId: borrower.id,
  borrowerSnapshot: loan.borrowerSnapshot,
  amount: 90000,
  receivedBy: "Maria Santos",
  balanceBefore: 200000,
  balanceAfter: 300000,
  allocation: [],
  date: "2026-12-05",
  nextDueDate: "2027-01-05",
  advance: {
    mode: "merge",
    carriedBalance: 200000,
    advanceFace: 100000,
    interest: 10000,
    netCash: 90000,
    newFace: 300000,
    newTerm: 3,
    newMonthly: 100000,
    previousLoanId: "previous",
    newLoanId: loan.id,
    schedule: loan.installments,
  },
};

describe("PDF export", () => {
  it("embeds the Unicode font and generates all document types as valid PDFs", async () => {
    const ttf = await readFile(
      new URL("./fonts/NotoSans-Regular.ttf", import.meta.url),
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(ttf));
    try {
      const files = await Promise.all([
        receiptPDF(txn, loan, settings),
        loanSlipPDF(loan, txn, settings),
        statementPDF(borrower, [loan], [txn], settings),
        reportPDF(
          {
            ...settings,
            business: { name: "OweMe - layout preview", address: "" },
          },
          {
            from: "2026-11-01",
            to: "2026-11-30",
            asOf: "2026-11-06",
            metrics: [
              ["Cash collected", "₱0.00"],
              ["Cash released", "₱0.00"],
              ["Net cash flow", "₱0.00"],
              ["Recognized finance charges", "₱0.00"],
            ],
            channels: [],
            aging: [
              ["1-7 days", "₱0.00"],
              ["8-30 days", "₱0.00"],
              ["31-60 days", "₱0.00"],
              ["61+ days", "₱0.00"],
            ],
            notes: [
              "Layout preview only. No borrower records are included.",
              "Collections are cash received, not pure profit. Finance charges are recognized proportionally to applied repayments. Current balances are separate from date-range activity.",
            ],
          },
        ),
      ]);
      expect(files.map((file) => file.name)).toEqual([
        "OM-20261205-0001.pdf",
        "L-001-02-agreement.pdf",
        "OweMe-001-statement.pdf",
        "OweMe-report-2026-11-06.pdf",
      ]);
      for (const file of files) {
        expect(file.type).toBe("application/pdf");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const text = new TextDecoder("latin1").decode(bytes);
        expect(text.startsWith("%PDF-1.")).toBe(true);
        expect(text).toContain("/FontFile2");
        expect(text).toContain("/Identity-H");
        expect(bytes.length).toBeGreaterThan(20_000);
      }
      if (process.env.OWEME_PDF_QA) {
        await mkdir("artifacts/pdf", { recursive: true });
        for (const file of files)
          await writeFile(
            `artifacts/pdf/${file.name}`,
            new Uint8Array(await file.arrayBuffer()),
          );
      }
    } finally {
      fetchMock.mockRestore();
    }
  });
  it("paginates a long statement instead of clipping the transaction history", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      ...txn,
      id: `payment-${i}`,
      type: "PAYMENT" as const,
      txnNo: `OM-20261205-${String(i + 2).padStart(4, "0")}`,
      amount: 1000,
    }));
    const file = await statementPDF(borrower, [loan], many, settings);
    const text = new TextDecoder("latin1").decode(await file.arrayBuffer());
    expect((text.match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(3);
  });
});
