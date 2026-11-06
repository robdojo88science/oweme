import { beforeEach, describe, expect, it } from "vitest";
import { db, initDB } from "./db";
import { balance, borrowerRating } from "../core/logic";
import { summarize } from "../ui/dashboard";
import { reportBreakdown } from "../ui/reporting";
import {
  addNote,
  createAdvance,
  createBorrower,
  createLoan,
  deleteBorrower,
  archiveBorrower,
  anonymizeBorrower,
  updateBorrower,
  attachLoanDocument,
  attachLoanSignature,
  receivePayment,
  voidTransaction,
} from "./service";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  await initDB();
});
const person = () =>
  createBorrower({
    fullName: "Juan Dela Cruz",
    address: "Purok 1, Barangay San Jose",
    monthlyIncome: 100000,
  });
async function initialLoan() {
  const b = await person();
  const result = await createLoan({
    borrowerId: b.id,
    amount: 300000,
    term: 3,
    releaseDate: "2026-11-05",
    releasedBy: "Maria",
  });
  return { b, ...result };
}
describe("atomic local ledger", () => {
  it("blocks issuing loans and advances to archived borrowers", async () => {
    const { b, loan } = await initialLoan();
    await archiveBorrower(b.id, `Delete ${b.fullName}`);
    await expect(
      createLoan({
        borrowerId: b.id,
        amount: 10000,
        term: 1,
        releaseDate: "2026-12-05",
        releasedBy: "Maria",
      }),
    ).rejects.toThrow("Restore the archived borrower");
    await expect(
      createAdvance({
        borrowerId: b.id,
        previousLoanId: loan.id,
        mode: "separate",
        inputMode: "face",
        amount: 10000,
        term: 3,
        releaseDate: "2026-12-05",
        releasedBy: "Maria",
      }),
    ).rejects.toThrow("Restore the archived borrower");
    expect(await db.loans.count()).toBe(1);
  });
  it("corrects an erroneous release only after reversing payments, retaining numbered history", async () => {
    const { loan, transaction } = await initialLoan();
    const payment = await receivePayment({
      loanId: loan.id,
      amount: 50000,
      date: "2026-12-05",
      method: "cash",
      receivedBy: "Maria",
    });
    await expect(
      voidTransaction(transaction.id, "Wrong loan", "2026-12-06"),
    ).rejects.toThrow("Void all payments");
    await voidTransaction(payment.transaction.id, "Wrong loan", "2026-12-06");
    const reversal = await voidTransaction(
      transaction.id,
      "Cash release entered twice",
      "2026-12-06",
    );
    expect(reversal).toMatchObject({
      type: "VOID",
      voidOf: transaction.id,
      amount: 270000,
      balanceAfter: 0,
    });
    expect((await db.loans.get(loan.id))?.status).toBe("voided");
    expect(await db.transactions.get(transaction.id)).toEqual(transaction);
    expect(await db.transactions.count()).toBe(4);
    expect(
      await db.auditLogs.where("entityId").equals(transaction.id).count(),
    ).toBe(1);
  });
  it("recognizes every carried finance charge once through chained merged advances", async () => {
    const { b, loan } = await initialLoan();
    await receivePayment({
      loanId: loan.id,
      amount: 100000,
      date: "2026-12-05",
      method: "cash",
      receivedBy: "Maria",
    });
    const a = await createAdvance({
      borrowerId: b.id,
      previousLoanId: loan.id,
      mode: "merge",
      inputMode: "face",
      amount: 100000,
      term: 3,
      releaseDate: "2026-12-05",
      releasedBy: "Maria",
    });
    await receivePayment({
      loanId: a.loan.id,
      amount: 100000,
      date: "2027-01-05",
      method: "cash",
      receivedBy: "Maria",
    });
    const bAdvance = await createAdvance({
      borrowerId: b.id,
      previousLoanId: a.loan.id,
      mode: "merge",
      inputMode: "face",
      amount: 100000,
      term: 3,
      releaseDate: "2027-01-05",
      releasedBy: "Maria",
    });
    await receivePayment({
      loanId: bAdvance.loan.id,
      amount: 300000,
      date: "2027-02-05",
      method: "cash",
      receivedBy: "Maria",
    });
    const data = {
      borrowers: await db.borrowers.toArray(),
      loans: await db.loans.toArray(),
      transactions: await db.transactions.toArray(),
      notes: [],
      settings: (await db.settings.get("settings"))!,
    };
    expect(
      summarize(data, "2026-01-01", "2027-12-31", "2027-02-05"),
    ).toMatchObject({ charges: 50000, collected: 500000, outstanding: 0 });
    expect(
      summarize(data, "2027-02-01", "2027-02-28", "2027-02-05").charges,
    ).toBe(30000);
  });
  it("allocates unique numbers concurrently and never reuses deleted borrower IDs", async () => {
    const borrowers = await Promise.all([person(), person(), person()]);
    expect(borrowers.map((x) => x.numericId)).toEqual([1, 2, 3]);
    await deleteBorrower(borrowers[1].id, "Delete Juan Dela Cruz");
    expect((await person()).numericId).toBe(4);
    expect(await db.tombstones.count()).toBe(1);
  });
  it("rejects cap violations without consuming counters or adding partial records", async () => {
    const b = await person();
    await expect(
      createLoan({
        borrowerId: b.id,
        amount: 300001,
        term: 3,
        releaseDate: "2026-11-05",
        releasedBy: "Maria",
      }),
    ).rejects.toThrow("cap");
    expect(await db.loans.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);
    const q = await createLoan({
      borrowerId: b.id,
      amount: 300001,
      term: 3,
      releaseDate: "2026-11-05",
      releasedBy: "Maria",
      overrideCap: true,
    });
    expect(q.loan.loanNo).toBe("L-001-01");
    expect(q.transaction.txnNo).toBe("OWM-DIS-2026-000001");
    expect(
      (await db.auditLogs.toArray()).some((x) => x.action === "OVERRIDE_CAP"),
    ).toBe(true);
  });
  it("stores 500 + 1500 receipts and appends reversal without editing the original", async () => {
    const { loan } = await initialLoan();
    const first = await receivePayment({
      loanId: loan.id,
      amount: 50000,
      date: "2026-12-05",
      method: "cash",
      receivedBy: "Maria",
    });
    const second = await receivePayment({
      loanId: loan.id,
      amount: 150000,
      date: "2026-12-06",
      method: "gcash",
      referenceNo: "REF-1",
      receivedBy: "Maria",
    });
    expect(first.transaction.balanceAfter).toBe(250000);
    expect(second.transaction.balanceBefore).toBe(250000);
    expect(second.transaction.balanceAfter).toBe(100000);
    const original = await db.transactions.get(first.transaction.id);
    const reversal = await voidTransaction(
      first.transaction.id,
      "Recorded twice",
      "2026-12-07",
    );
    expect(reversal.voidOf).toBe(first.transaction.id);
    expect(await db.transactions.get(first.transaction.id)).toEqual(original);
    expect(balance((await db.loans.get(loan.id))!)).toBe(150000);
    await expect(
      voidTransaction(first.transaction.id, "Again"),
    ).rejects.toThrow("already");
    expect(await db.transactions.count()).toBe(4);
  });
  it("preserves overpayment as explicit unapplied credit and completes the loan", async () => {
    const { loan } = await initialLoan();
    const paid = await receivePayment({
      loanId: loan.id,
      amount: 350000,
      date: "2026-11-06",
      method: "bank",
      receivedBy: "Maria",
    });
    expect(paid.transaction.unappliedAmount).toBe(50000);
    expect(paid.loan.status).toBe("completed");
    expect(
      paid.transaction.allocation.reduce((sum, x) => sum + x.amount, 0),
    ).toBe(300000);
  });
  it("keeps retained overpayment credit unapplied when an earlier repayment is reversed", async () => {
    const { loan } = await initialLoan();
    const first = await receivePayment({
      loanId: loan.id,
      amount: 200000,
      date: "2026-12-01",
      method: "cash",
      receivedBy: "Maria",
    });
    const second = await receivePayment({
      loanId: loan.id,
      amount: 150000,
      date: "2026-12-02",
      method: "cash",
      receivedBy: "Maria",
    });
    expect(second.transaction.unappliedAmount).toBe(50000);
    expect(
      second.transaction.allocation.reduce((sum, item) => sum + item.amount, 0),
    ).toBe(100000);
    await voidTransaction(
      first.transaction.id,
      "Payment entered for the wrong account",
      "2026-12-03",
    );
    expect(balance((await db.loans.get(loan.id))!)).toBe(200000);
    expect(await db.transactions.get(second.transaction.id)).toEqual(
      second.transaction,
    );
    const data = {
      borrowers: await db.borrowers.toArray(),
      loans: await db.loans.toArray(),
      transactions: await db.transactions.toArray(),
      notes: await db.notes.toArray(),
      settings: (await db.settings.get("settings"))!,
    };
    expect(
      summarize(data, "2026-11-01", "2026-12-31", "2026-12-03"),
    ).toMatchObject({
      outstanding: 200000,
      collected: 150000,
      charges: 10000,
      reversalTotal: 200000,
    });
    expect(
      reportBreakdown(data, "2026-11-01", "2026-12-31", "2026-12-03")
        .unappliedCredit,
    ).toBe(50000);
  });
  it("preserves both a signature attachment and a payment submitted concurrently", async () => {
    const { loan } = await initialLoan();
    const signature = {
      original: new Blob(["scan"], { type: "image/png" }),
      processed: new Blob(["signature"], { type: "image/png" }),
      signerName: "Juan Dela Cruz",
      capturedAt: "2026-12-05T01:00:00.000Z",
    };
    await Promise.all([
      receivePayment({
        loanId: loan.id,
        amount: 100000,
        date: "2026-12-05",
        method: "cash",
        receivedBy: "Maria",
      }),
      attachLoanSignature(loan.id, "borrower", signature),
    ]);
    const saved = (await db.loans.get(loan.id))!;
    expect(balance(saved)).toBe(200000);
    expect(await saved.signatures.borrower?.original.text()).toBe("scan");
    expect((await db.auditLogs.toArray()).map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["PAYMENT", "DOCUMENT_ATTACHED"]),
    );
  });
  it("rolls back a signature attachment if its required audit entry cannot be saved", async () => {
    const { loan } = await initialLoan();
    const rejectDocumentAudit = (_key: unknown, entry: { action: string }) => {
      if (entry.action === "DOCUMENT_ATTACHED")
        throw new Error("Audit write failed");
    };
    db.auditLogs.hook("creating", rejectDocumentAudit);
    try {
      await expect(
        attachLoanSignature(loan.id, "borrower", {
          original: new Blob(["scan"]),
          processed: new Blob(["signature"]),
          signerName: "Juan",
          capturedAt: "2026-12-05T01:00:00.000Z",
        }),
      ).rejects.toThrow("Audit write failed");
      expect(
        (await db.loans.get(loan.id))?.signatures.borrower,
      ).toBeUndefined();
      expect(balance((await db.loans.get(loan.id))!)).toBe(300000);
    } finally {
      db.auditLogs.hook("creating").unsubscribe(rejectDocumentAudit);
    }
  });
  it("freezes the receipt next due date and rejects a reversal predating its payment", async () => {
    const { loan } = await initialLoan();
    const first = await receivePayment({
      loanId: loan.id,
      amount: 100000,
      date: "2026-12-05",
      method: "cash",
      receivedBy: "Maria",
    });
    expect(first.transaction.nextDueDate).toBe("2027-01-05");
    await receivePayment({
      loanId: loan.id,
      amount: 100000,
      date: "2027-01-05",
      method: "cash",
      receivedBy: "Maria",
    });
    expect((await db.transactions.get(first.transaction.id))?.nextDueDate).toBe(
      "2027-01-05",
    );
    await expect(
      voidTransaction(first.transaction.id, "Wrong date", "2026-12-04"),
    ).rejects.toThrow("precede");
    expect(await db.transactions.count()).toBe(3);
  });
});
describe("advance chains and safe undo", () => {
  it("merges only new money, rolls old installments, writes timeline, then restores exactly", async () => {
    const { b, loan } = await initialLoan();
    await receivePayment({
      loanId: loan.id,
      amount: 100000,
      date: "2026-12-05",
      method: "cash",
      receivedBy: "Maria",
    });
    const old = await db.loans.get(loan.id);
    const next = await createAdvance({
      borrowerId: b.id,
      previousLoanId: loan.id,
      mode: "merge",
      amount: 100000,
      inputMode: "face",
      term: 3,
      releaseDate: "2026-12-05",
      releasedBy: "Maria",
    });
    expect(next.loan.faceAmount).toBe(300000);
    expect(next.loan.netRelease).toBe(90000);
    expect(next.previousLoan.status).toBe("merged");
    expect(next.previousLoan.installments.map((x) => x.status)).toEqual([
      "Paid",
      "rolled_over",
      "rolled_over",
    ]);
    expect(balance(next.previousLoan)).toBe(0);
    expect(next.loan.autoNote).toBe(next.transaction.notes);
    expect(
      (await db.notes.where("borrowerId").equals(b.id).first())?.text,
    ).toBe(next.loan.autoNote);
    expect(
      borrowerRating([next.previousLoan, next.loan], "2026-12-05").stars,
    ).toBe(5);
    await voidTransaction(
      next.transaction.id,
      "Borrower cancelled",
      "2026-12-05",
    );
    expect((await db.loans.get(loan.id))?.installments).toEqual(
      old?.installments,
    );
    expect((await db.loans.get(loan.id))?.status).toBe("active");
    expect((await db.loans.get(next.loan.id))?.status).toBe("voided");
    expect(await db.transactions.count()).toBe(4);
  });
  it("blocks undo until later payments are reversed and then safely restores", async () => {
    const { b, loan } = await initialLoan();
    await receivePayment({
      loanId: loan.id,
      amount: 100000,
      date: "2026-12-05",
      method: "cash",
      receivedBy: "Maria",
    });
    const adv = await createAdvance({
      borrowerId: b.id,
      previousLoanId: loan.id,
      mode: "merge",
      amount: 45000,
      inputMode: "cash",
      term: 3,
      releaseDate: "2026-12-05",
      releasedBy: "Maria",
    });
    expect(adv.loan.installments.map((x) => x.amountDue)).toEqual([
      83333, 83333, 83334,
    ]);
    const p = await receivePayment({
      loanId: adv.loan.id,
      amount: 10000,
      date: "2026-12-06",
      method: "cash",
      receivedBy: "Maria",
    });
    await expect(
      voidTransaction(adv.transaction.id, "Cancel", "2026-12-06"),
    ).rejects.toThrow("payments");
    await voidTransaction(p.transaction.id, "Cancel payment", "2026-12-06");
    await voidTransaction(adv.transaction.id, "Cancel", "2026-12-06");
    expect(balance((await db.loans.get(loan.id))!)).toBe(200000);
  });
  it("keeps separate loan untouched and applies combined exposure cap", async () => {
    const { b, loan } = await initialLoan();
    await receivePayment({
      loanId: loan.id,
      amount: 100000,
      date: "2026-12-05",
      method: "cash",
      receivedBy: "Maria",
    });
    const before = await db.loans.get(loan.id);
    await expect(
      createAdvance({
        borrowerId: b.id,
        previousLoanId: loan.id,
        mode: "separate",
        amount: 110000,
        inputMode: "face",
        term: 3,
        releaseDate: "2026-12-05",
        releasedBy: "Maria",
      }),
    ).rejects.toThrow("cap");
    const adv = await createAdvance({
      borrowerId: b.id,
      previousLoanId: loan.id,
      mode: "separate",
      amount: 100000,
      inputMode: "face",
      term: 3,
      releaseDate: "2026-12-05",
      releasedBy: "Maria",
    });
    expect(await db.loans.get(loan.id)).toEqual(before);
    expect(adv.loan.faceAmount).toBe(100000);
    expect(adv.loan.parentLoanId).toBe(loan.id);
    await voidTransaction(adv.transaction.id, "Cancelled", "2026-12-05");
    expect(await db.loans.get(loan.id)).toEqual(before);
  });
});
describe("archive and reviewed privacy controls", () => {
  it("creates a name-only borrower without requesting identity data", async () => {
    expect(await createBorrower({ fullName: "Ana" })).toMatchObject({
      fullName: "Ana",
      address: "",
      monthlyIncome: 0,
      numericId: 1,
    });
  });
  it("archives with an exact phrase and restores without changing a receipt or agreement", async () => {
    const { b, loan, transaction } = await initialLoan();
    await expect(
      archiveBorrower(b.id, "Delete juan Dela Cruz"),
    ).rejects.toThrow("exact");
    await archiveBorrower(b.id, "Delete Juan Dela Cruz");
    expect((await db.borrowers.get(b.id))?.status).toBe("archived");
    expect(await db.transactions.get(transaction.id)).toEqual(transaction);
    expect(await db.loans.get(loan.id)).toEqual(loan);
    await updateBorrower(b.id, { status: "active" });
    expect((await db.borrowers.get(b.id))?.status).toBe("active");
  });
  it("requires retention review for separate anonymization and retains amounts", async () => {
    const { b, loan, transaction } = await initialLoan();
    await expect(
      anonymizeBorrower(b.id, "Delete Juan Dela Cruz", false),
    ).rejects.toThrow("retention");
    await anonymizeBorrower(b.id, "Delete Juan Dela Cruz", true);
    expect(await db.borrowers.get(b.id)).toBeUndefined();
    expect((await db.loans.get(loan.id))?.borrowerSnapshot.fullName).toBe(
      "Anonymized borrower 001",
    );
    expect((await db.transactions.get(transaction.id))?.amount).toBe(270000);
  });
  it("requires a guideline override reason and freezes agreement wording", async () => {
    const b = await person();
    const input = {
      borrowerId: b.id,
      amount: 300000,
      term: 3,
      releaseDate: "2026-11-05",
      releasedBy: "Maria",
      affordabilityPercent: 30,
      overrideCap: true,
    };
    await expect(createLoan(input)).rejects.toThrow("reason");
    const { loan } = await createLoan({
      ...input,
      overrideReason: "Verified separate household income",
    });
    await db.settings.update("settings", {
      agreementText: "New terms for future loans",
    });
    expect(loan.agreementTextSnapshot).toContain("acknowledge");
    expect(loan.overrideReason).toBe("Verified separate household income");
  });
  it("keeps human-readable transaction numbers unique even if counters lag behind", async () => {
    const { loan } = await initialLoan();
    const first = await receivePayment({
      loanId: loan.id,
      amount: 50000,
      date: "2026-12-05",
      receivedBy: "Maria",
      method: "cash",
    });
    await db.counters.update("counters", { txnByDay: {} });
    const second = await receivePayment({
      loanId: loan.id,
      amount: 50000,
      date: "2026-12-06",
      receivedBy: "Maria",
      method: "cash",
    });
    expect(first.transaction.txnNo).toBe("OWM-PAY-2026-000001");
    expect(second.transaction.txnNo).toBe("OWM-PAY-2026-000002");
  });
  it("keeps appended paper documents and signature revisions tied to the issued loan", async () => {
    const { loan } = await initialLoan();
    const photo = new Blob(["signature"], { type: "image/png" });
    const scan = {
      original: photo,
      processed: photo,
      signerName: "Juan",
      capturedAt: "2026-11-05T01:00:00.000Z",
    };
    await attachLoanSignature(loan.id, "borrower", scan);
    await attachLoanSignature(loan.id, "borrower", {
      ...scan,
      capturedAt: "2026-11-06T01:00:00.000Z",
    });
    const first = await attachLoanDocument(
      loan.id,
      new Blob(["%PDF agreement"], { type: "application/pdf" }),
      "Signed paper.pdf",
    );
    await attachLoanDocument(loan.id, photo, "Paper photo.png");
    const saved = (await db.loans.get(loan.id))!;
    expect(saved.signatureHistory?.[0].signature.capturedAt).toBe(
      scan.capturedAt,
    );
    expect(saved.documents?.map((doc) => doc.name)).toEqual([
      "Signed paper.pdf",
      "Paper photo.png",
    ]);
    expect(saved.documents?.[0].id).toBe(first.id);
    expect(saved.installments).toEqual(loan.installments);
    await expect(
      attachLoanDocument(
        loan.id,
        new Blob(["exe"], { type: "application/octet-stream" }),
        "bad.exe",
      ),
    ).rejects.toThrow("PDF");
  });
  it("requires exact case-sensitive phrase, removes private account, retains all ledger records", async () => {
    const { b, loan } = await initialLoan();
    await addNote(b.id, "Private interview note");
    await expect(deleteBorrower(b.id, "Delete juan Dela Cruz")).rejects.toThrow(
      "exact",
    );
    expect(await db.borrowers.count()).toBe(1);
    await deleteBorrower(b.id, "Delete Juan Dela Cruz");
    expect(await db.borrowers.count()).toBe(0);
    expect(await db.notes.count()).toBe(0);
    expect(await db.loans.get(loan.id)).toBeDefined();
    const tx = await db.transactions.toArray();
    expect(tx[0].borrowerSnapshot.fullName).toBe("Juan Dela Cruz");
    expect(tx[0].borrowerSnapshot.numericId).toBe(1);
  });
});
