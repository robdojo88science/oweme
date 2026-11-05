import { beforeEach, describe, expect, it } from "vitest";
import { db, initDB } from "./db";
import { balance, borrowerRating } from "../core/logic";
import {
  addNote,
  createAdvance,
  createBorrower,
  createLoan,
  deleteBorrower,
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
    expect(q.transaction.txnNo).toBe("OM-20261105-0001");
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
describe("account deletion retains permanent history", () => {
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
