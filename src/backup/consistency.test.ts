import { beforeEach, describe, expect, it } from "vitest";
import { db, initDB } from "../data/db";
import {
  createAdvance,
  createBorrower,
  createLoan,
  receivePayment,
  voidTransaction,
} from "../data/service";
import {
  exportBackup,
  importBackup,
  previewImport,
  readBackupData,
} from "./index";
import { assertLedgerConsistency } from "./consistency";
import { encodeValue, parseBackup, sealBackup } from "./format";
import type { BackupFile } from "./format";

const reseal = async (backup: BackupFile) =>
  parseBackup(JSON.stringify(sealBackup(await encodeValue(backup))));
beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  await initDB();
});
async function baseLoan() {
  const borrower = await createBorrower({
    fullName: "Merge review",
    address: "",
    monthlyIncome: 100000,
  });
  const { loan } = await createLoan({
    borrowerId: borrower.id,
    amount: 300000,
    term: 3,
    releaseDate: "2026-11-05",
    releasedBy: "Owner",
  });
  return { borrower, loan, backup: parseBackup(await exportBackup()) };
}
const payment = (loanId: string, amount: number) =>
  receivePayment({
    loanId,
    amount,
    date: "2026-12-05",
    method: "cash",
    receivedBy: "Owner",
  });

describe("financial safe-merge verification", () => {
  it("preserves unapplied credit during reversal and validates a corrected release round-trip", async () => {
    const { loan } = await baseLoan();
    const first = await payment(loan.id, 200000);
    const second = await payment(loan.id, 150000);
    await voidTransaction(
      first.transaction.id,
      "Correct first payment",
      "2026-12-05",
    );
    const current = parseBackup(await exportBackup());
    expect(() => assertLedgerConsistency(current.tables)).not.toThrow();
    await importBackup(current, "replace");
    expect(
      (await db.loans.get(loan.id))?.installments.reduce(
        (s, i) => s + i.amountDue - i.amountPaid,
        0,
      ),
    ).toBe(200000);
    await voidTransaction(
      second.transaction.id,
      "Correct second payment",
      "2026-12-05",
    );
    const release = (await db.transactions.toArray()).find(
      (t) => t.type === "RELEASE",
    )!;
    await voidTransaction(release.id, "Erroneous release", "2026-12-05");
    const corrected = parseBackup(await exportBackup());
    expect(() => assertLedgerConsistency(corrected.tables)).not.toThrow();
    await importBackup(corrected, "replace");
    expect((await db.loans.get(loan.id))?.status).toBe("voided");
  });
  it("rejects an incomplete restore without losing settings or counters", async () => {
    await baseLoan();
    const before = await readBackupData();
    const backup = parseBackup(await exportBackup());
    backup.tables.counters = [];
    backup.tables.settings = [];
    const incomplete = await reseal(backup);
    await expect(importBackup(incomplete, "replace")).rejects.toThrow(
      "incomplete",
    );
    await expect(
      previewImport(JSON.stringify(await encodeValue(incomplete))),
    ).rejects.toThrow("incomplete");
    expect(await readBackupData()).toEqual(before);
    expect(await db.snapshots.count()).toBe(0);
  });
  it("accepts a single-device payment history extension and previews before/after accounting", async () => {
    const { loan, backup } = await baseLoan();
    await payment(loan.id, 50000);
    const incoming = await exportBackup();
    await importBackup(backup, "replace");
    const preview = await previewImport(incoming);
    expect(preview.mergeBlocked).toBeUndefined();
    expect(preview.accounting?.local.outstanding).toBe(300000);
    expect(preview.accounting?.incoming.outstanding).toBe(250000);
    expect(preview.accounting?.merged?.collected).toBe(50000);
    await importBackup(preview.backup, "merge", preview.accounting?.local);
    expect((await db.loans.get(loan.id))?.installments[0].amountPaid).toBe(
      50000,
    );
  });

  it("blocks independent payments on the same loan without writing data or a recovery snapshot", async () => {
    const { loan, backup } = await baseLoan();
    await payment(loan.id, 50000);
    const otherDevice = await exportBackup();
    await importBackup(backup, "replace");
    await payment(loan.id, 25000);
    const before = await readBackupData(),
      snapshots = await db.snapshots.count();
    const preview = await previewImport(otherDevice);
    expect(preview.mergeBlocked).toContain("independently on both devices");
    expect(preview.accounting?.merged).toBeUndefined();
    await expect(importBackup(preview.backup, "merge")).rejects.toThrow(
      "Cannot safely merge",
    );
    expect(await readBackupData()).toEqual(before);
    expect(await db.snapshots.count()).toBe(snapshots);
    await importBackup(preview.backup, "replace", preview.accounting?.local);
    expect((await db.loans.get(loan.id))?.installments[0].amountPaid).toBe(
      50000,
    );
  });

  it("rejects later-updated money edits for an existing transaction UUID even when the incoming totals balance", async () => {
    const { loan } = await baseLoan();
    await payment(loan.id, 50000);
    const incoming = parseBackup(await exportBackup());
    const txn = incoming.tables.transactions.find((t) => t.type === "PAYMENT")!;
    txn.amount = 60000;
    txn.balanceAfter = 240000;
    txn.allocation = [{ installmentNo: 1, amount: 60000 }];
    txn.updatedAt = "2099-01-01T00:00:00.000Z";
    (
      incoming.tables.loans[0].installments as { amountPaid: number }[]
    )[0].amountPaid = 60000;
    incoming.tables.loans[0].updatedAt = txn.updatedAt;
    await expect(importBackup(await reseal(incoming), "merge")).rejects.toThrow(
      "different immutable financial details",
    );
    expect((await db.transactions.get(txn.id))?.amount).toBe(50000);
    expect(await db.snapshots.count()).toBe(0);
  });

  it("blocks a later signature-only version that would overwrite newer financial state with stale installments", async () => {
    const { loan, backup } = await baseLoan();
    await payment(loan.id, 50000);
    backup.tables.loans[0].updatedAt = "2099-01-01T00:00:00.000Z";
    const preview = await previewImport(
      JSON.stringify(await encodeValue(await reseal(backup))),
    );
    expect(preview.mergeBlocked).toContain("installment balances disagree");
    await expect(importBackup(await reseal(backup), "merge")).rejects.toThrow(
      "installment balances disagree",
    );
  });

  it("accepts independent new loans on different branches and repairs duplicate display numbers", async () => {
    const { borrower, backup } = await baseLoan();
    await createLoan({
      borrowerId: borrower.id,
      amount: 100000,
      term: 3,
      releaseDate: "2026-11-06",
      releasedBy: "Owner",
    });
    const otherDevice = await exportBackup();
    await importBackup(backup, "replace");
    await createLoan({
      borrowerId: borrower.id,
      amount: 50000,
      term: 3,
      releaseDate: "2026-11-06",
      releasedBy: "Owner",
    });
    const preview = await previewImport(otherDevice);
    expect(preview.mergeBlocked).toBeUndefined();
    await importBackup(preview.backup, "merge");
    expect(await db.loans.count()).toBe(3);
    expect(new Set((await db.loans.toArray()).map((l) => l.loanNo)).size).toBe(
      3,
    );
    expect(() => assertLedgerConsistency(preview.backup.tables)).not.toThrow();
  });

  it("verifies merged advances and reversal replay without rewriting original receipt allocations", async () => {
    const { borrower, loan } = await baseLoan();
    const first = await payment(loan.id, 100000);
    const advance = await createAdvance({
      borrowerId: borrower.id,
      previousLoanId: loan.id,
      mode: "merge",
      amount: 100000,
      inputMode: "face",
      term: 3,
      releaseDate: "2026-12-05",
      releasedBy: "Owner",
    });
    const merged = parseBackup(await exportBackup());
    expect(() => assertLedgerConsistency(merged.tables)).not.toThrow();
    const applied = await payment(advance.loan.id, 50000);
    await voidTransaction(applied.transaction.id, "Correction", "2026-12-05");
    const corrected = parseBackup(await exportBackup());
    expect(() => assertLedgerConsistency(corrected.tables)).not.toThrow();
    await voidTransaction(
      advance.transaction.id,
      "No advance released",
      "2026-12-05",
    );
    const restored = parseBackup(await exportBackup());
    expect(() => assertLedgerConsistency(restored.tables)).not.toThrow();
    expect(
      (await db.transactions.get(first.transaction.id))?.allocation,
    ).toEqual([{ installmentNo: 1, amount: 100000 }]);
    await previewImport(await exportBackup());
  });

  it("requires fresh accounting review if a payment was recorded after preview", async () => {
    const { loan } = await baseLoan();
    const preview = await previewImport(await exportBackup());
    await payment(loan.id, 10000);
    await expect(
      importBackup(preview.backup, "replace", preview.accounting?.local),
    ).rejects.toThrow("changed after this preview");
    expect((await db.loans.get(loan.id))?.installments[0].amountPaid).toBe(
      10000,
    );
  });
});
